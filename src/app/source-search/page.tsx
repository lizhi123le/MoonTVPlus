/* eslint-disable @typescript-eslint/no-explicit-any, react-hooks/exhaustive-deps */
'use client';

import { ChevronUp, Globe, Loader2, Search, SearchX, Tv } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import {
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';

import { isAnimeCategoryText } from '@/lib/anime-keyword-expr';
import {
  CategoryNode,
  getChildCategories,
  getParentCategories,
  isHierarchicalCategories,
  pickDefaultSelection,
} from '@/lib/category-tree';
import { ApiSite } from '@/lib/config';
import { appendSpecialSourceParam } from '@/lib/special-source.client';
import {
  applyLocalSourceOrder,
  subscribeLocalSourceOrder,
} from '@/lib/source-order-local';
import { isTVBoxBridgeSource } from '@/lib/tvbox-bridge.shared';
import { SearchResult } from '@/lib/types';

import CapsuleSwitch from '@/components/CapsuleSwitch';
import PageLayout from '@/components/PageLayout';
import VideoCard from '@/components/VideoCard';

type Category = CategoryNode;

type ViewMode = 'browse' | 'search';
type SourceType = 'normal' | 'tvbox';

// 观影前保存的浏览快照，返回后恢复到上一步操作位置
const SOURCE_SEARCH_STATE_KEY = 'source_search_state';

interface SourceSearchSnapshot {
  sourceType?: SourceType;
  specialOnly?: boolean;
  apiSites: ApiSite[];
  selectedSource: string;
  categories: Category[];
  selectedParentCategory: string;
  selectedCategory: string;
  videos: SearchResult[];
  currentPage: number;
  hasMore: boolean;
  viewMode: ViewMode;
  searchKeyword: string;
  searchInputValue: string;
  scrollTop: number;
}

// 实际滚动容器是 document.body，这里同时兼容 documentElement
const getPageScrollTop = () =>
  document.body.scrollTop || document.documentElement.scrollTop || 0;

const scrollPageTo = (top: number) => {
  document.body.scrollTop = top;
  document.documentElement.scrollTop = top;
};

// 恢复动作需要在绘制前完成，避免闪现顶部；SSR 下退化为 useEffect
const useIsomorphicLayoutEffect =
  typeof window === 'undefined' ? useEffect : useLayoutEffect;

// 读取并消费快照：只在观影返回后恢复一次
const consumeSnapshot = (
  key: string,
  specialOnly: boolean
): SourceSearchSnapshot | null => {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(key);
    sessionStorage.removeItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SourceSearchSnapshot;
    if (
      (parsed.specialOnly ?? false) !== specialOnly ||
      !parsed?.selectedSource ||
      !Array.isArray(parsed.apiSites) ||
      !Array.isArray(parsed.categories) ||
      !Array.isArray(parsed.videos) ||
      parsed.videos.length === 0
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
};

// Loading skeleton for video cards
function VideoSkeleton() {
  return (
    <div className='grid grid-cols-3 gap-x-2 gap-y-14 sm:gap-y-20 px-0 sm:px-2 sm:grid-cols-[repeat(auto-fill,_minmax(11rem,_1fr))] sm:gap-x-8'>
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={`skeleton-${i}`} className='w-full animate-pulse'>
          <div className='aspect-[2/3] bg-gray-200 dark:bg-gray-700 rounded-xl mb-3' />
          <div className='h-4 bg-gray-200 dark:bg-gray-700 rounded mb-2 w-3/4' />
          <div className='h-3 bg-gray-200 dark:bg-gray-700 rounded w-1/2' />
        </div>
      ))}
    </div>
  );
}

function SourceSearchPageClient() {
  // special=1 表示这是从 /under 进入的特殊源版本：源列表只有特殊源
  const searchParams = useSearchParams();
  const isSpecialVersion = searchParams.get('special') === '1';
  const snapshotStorageKey = `${SOURCE_SEARCH_STATE_KEY}${
    isSpecialVersion ? '_special' : ''
  }`;
  const [sourceType, setSourceType] = useState<SourceType>('normal');
  const [error, setError] = useState<string | null>(null);
  const [apiSites, setApiSites] = useState<ApiSite[]>([]);
  const [selectedSource, setSelectedSource] = useState<string>('');
  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedParentCategory, setSelectedParentCategory] =
    useState<string>('');
  const [selectedCategory, setSelectedCategory] = useState<string>('');
  // 本地分类记忆是否可写：切源/快照恢复期间禁止写入，避免把旧分类记到新源上
  const [isInitialized, setIsInitialized] = useState(false);
  const [videos, setVideos] = useState<SearchResult[]>([]);
  const [isLoadingSources, setIsLoadingSources] = useState(true);
  const [isLoadingCategories, setIsLoadingCategories] = useState(false);
  const [isLoadingVideos, setIsLoadingVideos] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [viewMode, setViewMode] = useState<ViewMode>('browse');
  const [searchKeyword, setSearchKeyword] = useState<string>('');
  const [searchInputValue, setSearchInputValue] = useState<string>('');
  const [showBackToTop, setShowBackToTop] = useState(false);
  // 视频源过滤：伸缩搜索框的展开状态与关键字
  const [sourceFilter, setSourceFilter] = useState('');
  const [isSourceFilterExpanded, setIsSourceFilterExpanded] = useState(false);
  const sourceFilterInputRef = useRef<HTMLInputElement>(null);
  // 快照读取完成前不发请求，避免覆盖恢复的数据
  const [restoreChecked, setRestoreChecked] = useState(false);
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const snapshotRef = useRef<SourceSearchSnapshot | null>(null);
  const pendingScrollTopRef = useRef<number | null>(null);
  // 恢复时需要跳过一次「拉取分类」和「拉取列表」
  const skipCategoryFetchRef = useRef(false);
  const skipVideoFetchRef = useRef(false);

  // 保存源和分类到 localStorage
  const saveSourceCategoryToStorage = (source: string, category: string) => {
    if (!isInitialized || !source || !category) {
      return;
    }
    try {
      localStorage.setItem('sourceSearch_lastSource', source);

      // 使用 Map 存储每个源对应的分类
      const savedCategoriesJson =
        localStorage.getItem('sourceSearch_sourceCategories') || '{}';
      const savedCategories = JSON.parse(savedCategoriesJson);
      savedCategories[source] = category;
      localStorage.setItem(
        'sourceSearch_sourceCategories',
        JSON.stringify(savedCategories)
      );
    } catch (e) {
      console.error('[源站寻片] 保存源和分类失败:', e);
    }
  };

  // 从 localStorage 恢复源和分类
  const restoreSourceCategoryFromStorage = (
    source?: string
  ): { source: string; category: string } => {
    try {
      if (typeof window === 'undefined') return { source: '', category: '' };

      const lastSource = localStorage.getItem('sourceSearch_lastSource') || '';
      const targetSource = source || lastSource;

      const savedCategoriesJson =
        localStorage.getItem('sourceSearch_sourceCategories') || '{}';
      const savedCategories = JSON.parse(savedCategoriesJson);
      const category = savedCategories[targetSource] || '';

      return { source: lastSource, category };
    } catch (e) {
      console.error('[源站寻片] 读取源和分类失败:', e);
      return { source: '', category: '' };
    }
  };

  // 读取观影前保存的快照，恢复到上一步操作位置
  useIsomorphicLayoutEffect(() => {
    const snapshot = consumeSnapshot(snapshotStorageKey, isSpecialVersion);
    if (snapshot) {
      skipCategoryFetchRef.current = true;
      skipVideoFetchRef.current = true;
      pendingScrollTopRef.current = snapshot.scrollTop;
      setSourceType(
        snapshot.sourceType ||
          (isTVBoxBridgeSource(snapshot.selectedSource) ? 'tvbox' : 'normal')
      );
      setApiSites(snapshot.apiSites);
      setSelectedSource(snapshot.selectedSource);
      setCategories(snapshot.categories);
      // 旧快照没有一级分类时，从已选分类反推
      setSelectedParentCategory(
        snapshot.selectedParentCategory ||
          snapshot.categories.find(
            (item) => item.id === snapshot.selectedCategory
          )?.pid ||
          ''
      );
      setSelectedCategory(snapshot.selectedCategory);
      setVideos(snapshot.videos);
      setCurrentPage(snapshot.currentPage);
      setHasMore(snapshot.hasMore);
      setViewMode(snapshot.viewMode);
      setSearchKeyword(snapshot.searchKeyword);
      setSearchInputValue(snapshot.searchInputValue);
      // 源与分类均来自快照，视为已完成初始化，保证本地记忆继续生效
      setIsInitialized(true);
    }
    setRestoreChecked(true);
  }, []);

  // 列表渲染完成后再恢复滚动位置
  useIsomorphicLayoutEffect(() => {
    const target = pendingScrollTopRef.current;
    if (target == null || videos.length === 0) return;

    pendingScrollTopRef.current = null;
    scrollPageTo(target);
    const rafId = requestAnimationFrame(() => scrollPageTo(target));
    return () => cancelAnimationFrame(rafId);
  }, [videos]);

  // 镜像最新状态，供跳转播放页前保存快照
  useEffect(() => {
    snapshotRef.current = {
      sourceType,
      specialOnly: isSpecialVersion,
      apiSites,
      selectedSource,
      categories,
      selectedParentCategory,
      selectedCategory,
      videos,
      // 当前页还在请求中，回退一页以便返回后重新拉取，避免缺页
      currentPage:
        isLoadingVideos && currentPage > 1 ? currentPage - 1 : currentPage,
      hasMore,
      viewMode,
      searchKeyword,
      searchInputValue,
      scrollTop: 0,
    };
  }, [
    sourceType,
    isSpecialVersion,
    apiSites,
    selectedSource,
    categories,
    selectedParentCategory,
    selectedCategory,
    videos,
    currentPage,
    hasMore,
    viewMode,
    searchKeyword,
    searchInputValue,
    isLoadingVideos,
  ]);

  // 跳转播放页前保存当前浏览位置
  const saveSnapshot = useCallback(() => {
    const snapshot = snapshotRef.current;
    if (!snapshot || snapshot.videos.length === 0) return;
    try {
      sessionStorage.setItem(
        snapshotStorageKey,
        JSON.stringify({ ...snapshot, scrollTop: getPageScrollTop() })
      );
    } catch {
      // 忽略 sessionStorage 写入失败（如超出配额）
    }
  }, [snapshotStorageKey]);

  // 类型切换及离开页面时取消旧请求，防止旧列表覆盖当前选择。
  useEffect(() => {
    if (!restoreChecked) return;
    const controller = new AbortController();
    const fetchApiSites = async () => {
      setIsLoadingSources(true);
      setError(null);
      try {
        const response = await fetch(
          appendSpecialSourceParam(
            `/api/source-search/sources?type=${sourceType}`
          ),
          { signal: controller.signal }
        );
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || '加载视频源失败');
        if (controller.signal.aborted) return;
        // 本地顺序优先：后台刚改完排序时服务端可能尚未同步，这里立即按本地顺序显示
        const sites = applyLocalSourceOrder(
          (Array.isArray(data.sources) ? data.sources : []) as ApiSite[]
        );
        setApiSites(sites);
        const saved = restoreSourceCategoryFromStorage();
        const hasSource = (key: string) =>
          !!key && sites.some((site: ApiSite) => site.key === key);
        // 观影返回的快照源优先，其次是上次记住的源，最后回退到第一个源
        setSelectedSource((previous) => {
          if (hasSource(previous)) return previous;
          if (hasSource(saved.source)) return saved.source;
          return sites[0]?.key || '';
        });
      } catch (error) {
        if (controller.signal.aborted) return;
        setApiSites([]);
        setSelectedSource('');
        setError(error instanceof Error ? error.message : '加载视频源失败');
      } finally {
        if (!controller.signal.aborted) setIsLoadingSources(false);
      }
    };
    fetchApiSites();
    return () => controller.abort();
  }, [restoreChecked, sourceType, isSpecialVersion]);

  // 后台在另一个标签页改完排序后，本地顺序会写入 localStorage。
  // 这里监听变化并立即重排当前列表，避免必须刷新页面才看到新顺序。
  useEffect(() => {
    const reapply = () => {
      // 输入是内存中可能已重排过的列表，禁止触发收敛清除
      setApiSites((prev) => applyLocalSourceOrder(prev, { converge: false }));
    };

    const unsubscribe = subscribeLocalSourceOrder(reapply);
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') reapply();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      unsubscribe();
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, []);

  useEffect(() => {
    if (!restoreChecked || !selectedSource) return;
    if (skipCategoryFetchRef.current) {
      skipCategoryFetchRef.current = false;
      return;
    }
    const controller = new AbortController();
    const fetchCategories = async () => {
      setIsLoadingCategories(true);
      setIsLoadingVideos(false);
      setError(null);
      setCategories([]);
      setSelectedParentCategory('');
      setSelectedCategory('');
      setVideos([]);
      setCurrentPage(1);
      setHasMore(true);
      try {
        const response = await fetch(
          appendSpecialSourceParam(
            `/api/source-search/categories?source=${encodeURIComponent(
              selectedSource
            )}`
          ),
          { signal: controller.signal }
        );
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || '加载分类失败');
        if (controller.signal.aborted) return;
        const list = Array.isArray(data.categories)
          ? (data.categories as Category[])
          : [];
        setCategories(list);

        // 优先恢复该源上次选择的分级分类（本地记忆），否则按上游默认策略选择
        const saved = restoreSourceCategoryFromStorage(selectedSource);
        const savedNode = saved.category
          ? list.find((item: Category) => item.id === saved.category)
          : undefined;
        if (savedNode) {
          if (savedNode.pid) {
            setSelectedParentCategory(savedNode.pid);
            setSelectedCategory(savedNode.id);
          } else {
            // 记住的是一级分类：落到其第一个子分类（平铺源则直接用自身）
            const children = getChildCategories(list, savedNode.id);
            setSelectedParentCategory(savedNode.id);
            setSelectedCategory(
              children.length > 0 ? children[0].id : savedNode.id
            );
          }
        } else {
          const { parent, category } = pickDefaultSelection(list);
          setSelectedParentCategory(parent);
          setSelectedCategory(category);
        }

        // 只有在分类加载并尝试恢复后，才允许写入本地记忆
        setIsInitialized(true);
      } catch (error) {
        if (!controller.signal.aborted) {
          setError(error instanceof Error ? error.message : '加载分类失败');
        }
      } finally {
        if (!controller.signal.aborted) setIsLoadingCategories(false);
      }
    };
    fetchCategories();
    return () => controller.abort();
  }, [restoreChecked, selectedSource, isSpecialVersion]);

  // 当选择的分类变化时，保存到 localStorage
  useEffect(() => {
    if (isInitialized && selectedSource && selectedCategory) {
      saveSourceCategoryToStorage(selectedSource, selectedCategory);
    }
  }, [selectedSource, selectedCategory, isInitialized]);

  // 分类浏览和单站搜索共用分页加载流程。
  useEffect(() => {
    if (!restoreChecked || !selectedSource) return;
    if (viewMode === 'browse' ? !selectedCategory : !searchKeyword) return;
    if (skipVideoFetchRef.current) {
      skipVideoFetchRef.current = false;
      return;
    }
    const controller = new AbortController();
    const fetchVideos = async () => {
      setIsLoadingVideos(true);
      setError(null);
      try {
        const query = new URLSearchParams({
          source: selectedSource,
          page: String(currentPage),
        });
        query.set(
          viewMode === 'browse' ? 'categoryId' : 'keyword',
          viewMode === 'browse' ? selectedCategory : searchKeyword
        );
        const response = await fetch(
          appendSpecialSourceParam(
            `/api/source-search/${
              viewMode === 'browse' ? 'videos' : 'search'
            }?${query}`
          ),
          { signal: controller.signal }
        );
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || '加载视频失败');
        if (controller.signal.aborted) return;
        const results = Array.isArray(data.results) ? data.results : [];
        setVideos((previous) =>
          currentPage === 1 ? results : [...previous, ...results]
        );
        setHasMore(data.page < data.pageCount);
      } catch (error) {
        if (!controller.signal.aborted) {
          setError(error instanceof Error ? error.message : '加载视频失败');
          setHasMore(false);
        }
      } finally {
        if (!controller.signal.aborted) setIsLoadingVideos(false);
      }
    };
    fetchVideos();
    return () => controller.abort();
  }, [
    restoreChecked,
    selectedSource,
    selectedCategory,
    searchKeyword,
    currentPage,
    viewMode,
    isSpecialVersion,
  ]);

  const handleSourceTypeChange = (value: string) => {
    if (value === sourceType) return;
    skipCategoryFetchRef.current = false;
    skipVideoFetchRef.current = false;
    setIsInitialized(false);
    setSourceType(value as SourceType);
    setApiSites([]);
    setSelectedSource('');
    setCategories([]);
    setSelectedParentCategory('');
    setSelectedCategory('');
    setSourceFilter('');
    setIsLoadingSources(true);
    setIsLoadingCategories(false);
    setIsLoadingVideos(false);
    setError(null);
    handleBackToBrowse();
  };

  // 切换一级分类（类型）时，落到该类型下第一个子分类并重置到第一页
  const handleParentCategoryChange = (value: string) => {
    setSelectedParentCategory(value);
    setCurrentPage(1);
    setVideos([]);
    setHasMore(true);
    const children = getChildCategories(categories, value);
    setSelectedCategory(children.length > 0 ? children[0].id : value);
  };

  // 切换分类时，重置到第一页
  const handleCategoryChange = (value: string) => {
    setSelectedCategory(value);
    setCurrentPage(1);
    setVideos([]);
    setHasMore(true);
  };

  // 处理源选择：切换源时先关闭本地记忆写入，避免把旧分类记到新源上
  const handleSourceChange = (value: string) => {
    if (value === selectedSource && viewMode === 'browse') return;
    setIsInitialized(false);
    setSelectedSource(value);
    handleBackToBrowse();
  };

  // 处理搜索提交
  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchInputValue.trim()) {
      setSearchKeyword(searchInputValue.trim());
      setViewMode('search');
      setCurrentPage(1);
      setVideos([]);
      setHasMore(true);
    }
  };

  // 切换回浏览模式
  const handleBackToBrowse = () => {
    setViewMode('browse');
    setSearchKeyword('');
    setSearchInputValue('');
    setCurrentPage(1);
    setVideos([]);
    setHasMore(true);
  };

  // Intersection Observer for infinite scroll
  // 哨兵节点仅在列表非空时渲染；快照恢复不发请求、isLoadingVideos 不翻转，
  // 需要依赖列表出现才能（重新）挂载观察器
  const hasVideos = videos.length > 0;
  useEffect(() => {
    if (!hasVideos || !loadMoreRef.current) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const target = entries[0];
        if (target.isIntersecting && hasMore && !isLoadingVideos) {
          setCurrentPage((prev) => prev + 1);
        }
      },
      { threshold: 0.1 }
    );

    observer.observe(loadMoreRef.current);

    return () => {
      observer.disconnect();
    };
  }, [hasVideos, hasMore, isLoadingVideos]);

  // 滚动超过一屏后显示置顶按钮
  useEffect(() => {
    const handleScroll = () => {
      setShowBackToTop(getPageScrollTop() > 300);
    };

    handleScroll();
    document.body.addEventListener('scroll', handleScroll, { passive: true });
    window.addEventListener('scroll', handleScroll, { passive: true });

    return () => {
      document.body.removeEventListener('scroll', handleScroll);
      window.removeEventListener('scroll', handleScroll);
    };
  }, []);

  // 返回顶部
  const scrollToTop = () => {
    try {
      document.body.scrollTo({ top: 0, behavior: 'smooth' });
      document.documentElement.scrollTo({ top: 0, behavior: 'smooth' });
    } catch {
      scrollPageTo(0);
    }
  };

  // 根据分类列表推导两级结构；平铺源回退为单行分类
  const isHierarchical = isHierarchicalCategories(categories);
  const parentCategories = isHierarchical
    ? getParentCategories(categories)
    : [];
  const subCategories =
    isHierarchical && selectedParentCategory
      ? getChildCategories(categories, selectedParentCategory)
      : [];
  // 按名称过滤视频源
  const sourceFilterKeyword = sourceFilter.trim().toLowerCase();
  const filteredApiSites = sourceFilterKeyword
    ? apiSites.filter((site) =>
        site.name.toLowerCase().includes(sourceFilterKeyword)
      )
    : apiSites;

  return (
    <PageLayout activePath='/source-search'>
      {/* 装饰性背景效果 */}
      <div className='fixed inset-0 -z-10 overflow-hidden pointer-events-none'>
        <div className='absolute top-0 -left-40 w-80 h-80 bg-indigo-500/20 rounded-full blur-3xl' />
        <div className='absolute top-1/3 -right-40 w-96 h-96 bg-purple-500/15 rounded-full blur-3xl' />
        <div className='absolute -bottom-40 left-1/3 w-80 h-80 bg-blue-500/15 rounded-full blur-3xl' />
      </div>

      <div className='px-4 sm:px-10 py-6 sm:py-10 overflow-visible mb-10 relative'>
        {/* 页面标题 */}
        <div className='mb-6'>
          <h1 className='flex items-center gap-2 text-2xl font-bold text-indigo-600 dark:text-indigo-400 mb-1'>
            源站寻片
            {isSpecialVersion && (
              <span className='rounded-full bg-purple-100 px-2 py-0.5 text-xs font-medium text-purple-600 dark:bg-purple-900/30 dark:text-purple-400'>
                特殊源
              </span>
            )}
          </h1>
          <p className='text-sm text-gray-500 dark:text-gray-400'>
            {isSpecialVersion
              ? '仅浏览与搜索特殊源的内容'
              : '根据可用视频源浏览分类内容，畅享海量视频'}
          </p>
        </div>

        {/* 搜索框 */}
        <div className='mb-6'>
          <form onSubmit={handleSearch}>
            <div className='relative group'>
              <div className='absolute inset-0 bg-gradient-to-r from-indigo-500/20 via-purple-500/20 to-blue-500/20 rounded-xl blur-xl group-hover:blur-2xl transition-all duration-500 opacity-50' />
              <div className='relative flex items-center'>
                <input
                  type='text'
                  value={searchInputValue}
                  onChange={(e) => setSearchInputValue(e.target.value)}
                  placeholder='搜索视频...'
                  className='w-full h-12 rounded-xl bg-white/80 dark:bg-gray-800/80 backdrop-blur-xl py-3 pl-5 pr-14 text-sm text-gray-700 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-400/50 focus:bg-white dark:focus:bg-gray-700 border border-gray-200/50 dark:border-gray-700/50 shadow-lg transition-all'
                />
                <button
                  type='submit'
                  aria-label='搜索视频'
                  className='absolute right-2 top-1/2 -translate-y-1/2 p-2.5 rounded-lg bg-gradient-to-r from-indigo-500 to-purple-500 text-white hover:from-indigo-600 hover:to-purple-600 shadow-lg hover:shadow-xl transition-all hover:scale-105 active:scale-95'
                >
                  <Search size={18} />
                </button>
              </div>
            </div>
          </form>
        </div>

        {/* 搜索结果提示和返回按钮 */}
        {viewMode === 'search' && searchKeyword && (
          <div className='mb-6'>
            <div className='flex items-center justify-between bg-indigo-50/80 dark:bg-indigo-900/30 border border-indigo-200/50 dark:border-indigo-800/30 rounded-xl px-4 py-3'>
              <div className='flex items-center gap-2'>
                <SearchX className='h-4 w-4 text-indigo-500' />
                <span className='text-sm text-gray-700 dark:text-gray-300'>
                  搜索结果:{' '}
                  <span className='font-semibold text-indigo-600 dark:text-indigo-400'>
                    {searchKeyword}
                  </span>
                </span>
              </div>
              <button
                type='button'
                onClick={handleBackToBrowse}
                className='text-sm text-indigo-600 hover:text-indigo-700 dark:text-indigo-400 dark:hover:text-indigo-300 font-medium'
              >
                返回分类浏览
              </button>
            </div>
          </div>
        )}

        {/* 源选择和分类选择 */}
        <div className='w-full mb-6 space-y-3'>
          {error && (
            <p role='alert' className='text-sm text-red-600 dark:text-red-400'>
              {error}
            </p>
          )}
          {/* 源选择 CapsuleSwitch */}
          <div className='relative'>
            <div className='flex items-center justify-start gap-3 mb-2'>
              <div
                className='flex items-center gap-1'
                role='group'
                aria-label='视频源类型'
              >
                {[
                  { label: '普通源', value: 'normal', icon: Globe },
                  { label: 'TVBox 源', value: 'tvbox', icon: Tv },
                ].map(({ label, value, icon: Icon }) => (
                  <button
                    key={value}
                    type='button'
                    aria-label={label}
                    title={label}
                    aria-pressed={sourceType === value}
                    onClick={() => handleSourceTypeChange(value)}
                    className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 ${
                      sourceType === value
                        ? 'bg-blue-100 text-blue-600 dark:bg-blue-900/40 dark:text-blue-400'
                        : 'text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300'
                    }`}
                  >
                    <Icon size={18} aria-hidden='true' />
                  </button>
                ))}
              </div>
              {/* 过滤视频源：伸缩搜索框 */}
              <div
                className={`flex items-center h-9 bg-gray-50/80 dark:bg-gray-800 border border-gray-200/50 dark:border-gray-700 rounded-lg shadow-sm transition-all duration-300 ease-in-out overflow-hidden ${
                  isSourceFilterExpanded ? 'w-44 sm:w-56' : 'w-9'
                }`}
              >
                <button
                  type='button'
                  aria-label='过滤视频源'
                  onClick={() => {
                    setIsSourceFilterExpanded(true);
                    sourceFilterInputRef.current?.focus();
                  }}
                  className='flex-none w-9 h-9 flex items-center justify-center text-blue-500 hover:text-blue-600 transition-colors focus:outline-none focus-visible:outline-none'
                >
                  <Search size={18} />
                </button>
                <input
                  ref={sourceFilterInputRef}
                  type='text'
                  value={sourceFilter}
                  onChange={(e) => setSourceFilter(e.target.value)}
                  onFocus={() => setIsSourceFilterExpanded(true)}
                  // 内容为空失焦时收起搜索框
                  onBlur={() => {
                    if (!sourceFilter.trim()) setIsSourceFilterExpanded(false);
                  }}
                  placeholder='过滤视频源...'
                  tabIndex={isSourceFilterExpanded ? 0 : -1}
                  className={`min-w-0 w-full h-9 pr-3 text-sm bg-transparent border-0 focus:outline-none focus:ring-0 text-gray-700 dark:text-gray-300 placeholder:text-gray-400 dark:placeholder:text-gray-500 transition-opacity duration-300 ${
                    isSourceFilterExpanded
                      ? 'opacity-100'
                      : 'opacity-0 pointer-events-none'
                  }`}
                />
              </div>
            </div>
            {isLoadingSources && apiSites.length === 0 ? (
              <div className='flex items-center justify-center h-12 bg-gray-50/80 rounded-lg border border-gray-200/50 dark:bg-gray-800 dark:border-gray-700'>
                <Loader2 className='h-5 w-5 animate-spin text-gray-400' />
                <span className='ml-2 text-sm text-gray-500 dark:text-gray-400'>
                  加载视频源中...
                </span>
              </div>
            ) : apiSites.length === 0 ? (
              <div className='flex items-center justify-center h-12 bg-gray-50/80 rounded-lg border border-gray-200/50 dark:bg-gray-800 dark:border-gray-700'>
                <span className='text-sm text-gray-500 dark:text-gray-400'>
                  暂无可用源
                </span>
              </div>
            ) : filteredApiSites.length === 0 ? (
              <div className='flex items-center justify-center h-12 bg-gray-50/80 rounded-lg border border-gray-200/50 dark:bg-gray-800 dark:border-gray-700'>
                <span className='text-sm text-gray-500 dark:text-gray-400'>
                  没有匹配的视频源
                </span>
              </div>
            ) : (
              <div className='flex'>
                <CapsuleSwitch
                  options={filteredApiSites.map((site) => ({
                    label: site.name,
                    value: site.key,
                  }))}
                  active={selectedSource}
                  onChange={handleSourceChange}
                />
              </div>
            )}
          </div>

          {/* 分类选择：两级源为「类型 → 分类」联动，平铺源仅显示分类 */}
          {selectedSource && viewMode === 'browse' && (
            <div className='relative space-y-3'>
              {isLoadingCategories && categories.length === 0 ? (
                <div className='flex items-center justify-center h-12 bg-gray-50/80 rounded-lg border border-gray-200/50 dark:bg-gray-800 dark:border-gray-700'>
                  <Loader2 className='h-5 w-5 animate-spin text-gray-400' />
                  <span className='ml-2 text-sm text-gray-500 dark:text-gray-400'>
                    加载分类中...
                  </span>
                </div>
              ) : categories.length === 0 ? (
                <div className='flex items-center justify-center h-12 bg-gray-50/80 rounded-lg border border-gray-200/50 dark:bg-gray-800 dark:border-gray-700'>
                  <span className='text-sm text-gray-500 dark:text-gray-400'>
                    暂无分类
                  </span>
                </div>
              ) : isHierarchical ? (
                <>
                  <div>
                    <div className='flex'>
                      <CapsuleSwitch
                        options={parentCategories.map((category) => ({
                          label: category.name,
                          value: category.id,
                        }))}
                        active={selectedParentCategory}
                        onChange={handleParentCategoryChange}
                      />
                    </div>
                  </div>
                  {subCategories.length > 0 && (
                    <div>
                      <div className='flex'>
                        <CapsuleSwitch
                          options={subCategories.map((category) => ({
                            label: category.name,
                            value: category.id,
                          }))}
                          active={selectedCategory}
                          onChange={handleCategoryChange}
                        />
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <div>
                  <div className='flex'>
                    <CapsuleSwitch
                      options={categories.map((category) => ({
                        label: category.name,
                        value: category.id,
                      }))}
                      active={selectedCategory}
                      onChange={handleCategoryChange}
                    />
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* 视频列表 */}
        {selectedSource &&
          (viewMode === 'search' ? searchKeyword : selectedCategory) && (
            <div className='max-w-[95%] mx-auto mt-8'>
              {viewMode === 'search' && (
                <div className='mb-4'>
                  {/* 标题区域：两侧渐隐分隔线 */}
                  <div className='flex items-center gap-3 mb-6'>
                    <div className='h-px flex-1 bg-gradient-to-r from-transparent via-indigo-300/50 to-transparent dark:via-indigo-700/50' />
                    <h2 className='text-xl font-bold text-gray-800 dark:text-gray-200 px-4'>
                      搜索结果
                    </h2>
                    <div className='h-px flex-1 bg-gradient-to-r from-transparent via-indigo-300/50 to-transparent dark:via-indigo-700/50' />
                  </div>
                </div>
              )}

              {isLoadingVideos && currentPage === 1 ? (
                <VideoSkeleton />
              ) : videos.length === 0 ? (
                <div className='flex flex-col items-center justify-center py-16 bg-white/40 dark:bg-gray-800/40 backdrop-blur-xl rounded-2xl border border-gray-200/50 dark:border-gray-700/50 shadow-xl'>
                  <SearchX className='h-16 w-16 text-gray-300 dark:text-gray-600 mb-4' />
                  <p className='text-lg text-gray-500 dark:text-gray-400 mb-2'>
                    暂无视频
                  </p>
                  <p className='text-sm text-gray-400 dark:text-gray-500'>
                    试试其他分类或搜索关键词
                  </p>
                </div>
              ) : (
                <>
                  <div className='grid grid-cols-3 gap-x-2 gap-y-14 sm:gap-y-20 px-0 sm:px-2 sm:grid-cols-[repeat(auto-fill,_minmax(11rem,_1fr))] sm:gap-x-8'>
                    {videos.map((item) => (
                      <div key={`${item.source}-${item.id}`} className='w-full'>
                        <VideoCard
                          id={item.id}
                          title={item.title}
                          poster={item.poster}
                          episodes={item.vod_total || item.episodes.length}
                          source={item.source}
                          source_name={item.source_name}
                          douban_id={item.douban_id}
                          year={item.year}
                          from='source-search'
                          type={
                            (item.vod_total || item.episodes.length) > 1
                              ? 'tv'
                              : 'movie'
                          }
                          isAnime={isAnimeCategoryText(
                            item.type_name,
                            item.class
                          )}
                          typeName={item.type_name || item.class}
                          cmsData={
                            isTVBoxBridgeSource(item.source)
                              ? undefined
                              : {
                                  desc: item.desc,
                                  episodes: item.episodes,
                                  episodes_titles: item.episodes_titles,
                                }
                          }
                          onBeforeNavigate={saveSnapshot}
                        />
                      </div>
                    ))}
                  </div>

                  {/* Infinite scroll trigger */}
                  <div
                    ref={loadMoreRef}
                    className='flex justify-center items-center py-8'
                  >
                    {isLoadingVideos && (
                      <div className='animate-spin rounded-full h-6 w-6 border-b-2 border-blue-500'></div>
                    )}
                    {!hasMore && videos.length > 0 && (
                      <span className='text-sm text-gray-500 dark:text-gray-400'>
                        没有更多了
                      </span>
                    )}
                  </div>
                </>
              )}
            </div>
          )}
      </div>

      {/* 置顶（返回顶部）悬浮按钮 */}
      <button
        onClick={scrollToTop}
        className={`fixed bottom-20 md:bottom-6 right-6 z-[500] w-12 h-12 bg-green-500/90 hover:bg-green-500 text-white rounded-full shadow-lg backdrop-blur-sm transition-all duration-300 ease-in-out flex items-center justify-center group ${
          showBackToTop
            ? 'opacity-100 translate-y-0 pointer-events-auto'
            : 'opacity-0 translate-y-4 pointer-events-none'
        }`}
        aria-label='返回顶部'
      >
        <ChevronUp className='w-6 h-6 transition-transform group-hover:scale-110' />
      </button>
    </PageLayout>
  );
}

export default function SourceSearchPage() {
  return (
    <Suspense>
      <SourceSearchPageClient />
    </Suspense>
  );
}
