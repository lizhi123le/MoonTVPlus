/* eslint-disable @typescript-eslint/no-explicit-any, react-hooks/exhaustive-deps */
'use client';

import {
  ChevronUp,
  Globe2,
  Loader2,
  Search,
  SearchX,
  Sparkles,
} from 'lucide-react';
import {
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';

import { isAnimeCategoryText } from '@/lib/anime-keyword-expr';
import { ApiSite } from '@/lib/config';
import { appendSpecialSourceParam } from '@/lib/special-source.client';
import { SearchResult } from '@/lib/types';

import CapsuleSwitch from '@/components/CapsuleSwitch';
import PageLayout from '@/components/PageLayout';
import VideoCard from '@/components/VideoCard';

interface Category {
  id: string;
  name: string;
}

type ViewMode = 'browse' | 'search';

// 观影前保存的浏览快照，返回后恢复到上一步操作位置
const SOURCE_SEARCH_STATE_KEY = 'source_search_state';

interface SourceSearchSnapshot {
  apiSites: ApiSite[];
  selectedSource: string;
  categories: Category[];
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
const consumeSnapshot = (): SourceSearchSnapshot | null => {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(SOURCE_SEARCH_STATE_KEY);
    sessionStorage.removeItem(SOURCE_SEARCH_STATE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SourceSearchSnapshot;
    if (
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

// Loading skeleton for categories dropdown
function CategoryDropdownSkeleton() {
  return (
    <div className="flex items-center justify-center h-10 bg-gray-100/80 dark:bg-gray-700/80 backdrop-blur-sm rounded-lg">
      <div className="flex items-center gap-2">
        <Loader2 className="h-4 w-4 animate-spin text-gray-400" />
        <span className="text-sm text-gray-500 dark:text-gray-400">加载分类中...</span>
      </div>
    </div>
  );
}

// Loading skeleton for video cards
function VideoSkeleton() {
  return (
    <div className="grid grid-cols-3 gap-x-2 gap-y-14 sm:gap-y-20 px-0 sm:px-2 sm:grid-cols-[repeat(auto-fill,_minmax(11rem,_1fr))] sm:gap-x-8">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={`skeleton-${i}`} className="w-full animate-pulse">
          <div className="aspect-[2/3] bg-gray-200 dark:bg-gray-700 rounded-xl mb-3" />
          <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded mb-2 w-3/4" />
          <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-1/2" />
        </div>
      ))}
    </div>
  );
}

function SourceSearchPageClient() {
  const [apiSites, setApiSites] = useState<ApiSite[]>([]);
  const [selectedSource, setSelectedSource] = useState<string>('');
  const [selectedSourceName, setSelectedSourceName] = useState<string>('');
  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>('');
  const [videos, setVideos] = useState<SearchResult[]>([]);
  const [isLoadingSources, setIsLoadingSources] = useState(true);
  const [isLoadingCategories, setIsLoadingCategories] = useState(false);
  const [isLoadingVideos, setIsLoadingVideos] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [viewMode, setViewMode] = useState<ViewMode>('browse');
  const [searchKeyword, setSearchKeyword] = useState<string>('');
  const [searchInputValue, setSearchInputValue] = useState<string>('');
  const [showCategoryDropdown, setShowCategoryDropdown] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);  // 标记是否已初始化
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const isFirstRender = useRef(true);  // 标记是否是首次渲染
  const [showBackToTop, setShowBackToTop] = useState(false);
  // 视频源过滤：伸缩搜索框的展开状态与关键字
  const [sourceFilter, setSourceFilter] = useState('');
  const [isSourceFilterExpanded, setIsSourceFilterExpanded] = useState(false);
  const sourceFilterInputRef = useRef<HTMLInputElement>(null);
  // 快照读取完成前不发请求，避免覆盖恢复的数据
  const [restoreChecked, setRestoreChecked] = useState(false);
  const snapshotRef = useRef<SourceSearchSnapshot | null>(null);
  const pendingScrollTopRef = useRef<number | null>(null);
  // 恢复时需要跳过一次「拉取分类」和「拉取列表」
  const skipCategoryFetchRef = useRef(false);
  const skipVideoFetchRef = useRef(false);

  // 读取观影前保存的快照，恢复到上一步操作位置
  useIsomorphicLayoutEffect(() => {
    const snapshot = consumeSnapshot();
    if (snapshot) {
      skipCategoryFetchRef.current = true;
      skipVideoFetchRef.current = true;
      pendingScrollTopRef.current = snapshot.scrollTop;
      setApiSites(snapshot.apiSites);
      setSelectedSource(snapshot.selectedSource);
      setCategories(snapshot.categories);
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

  // 保存源和分类到 localStorage
  const saveSourceCategoryToStorage = (source: string, category: string) => {
    if (!isInitialized || !source || !category) {
      return;
    }
    try {
      console.log('[源站寻片] 保存到 localStorage:', { source, category });
      localStorage.setItem('sourceSearch_lastSource', source);
      
      // 使用 Map 存储每个源对应的分类
      const savedCategoriesJson = localStorage.getItem('sourceSearch_sourceCategories') || '{}';
      const savedCategories = JSON.parse(savedCategoriesJson);
      savedCategories[source] = category;
      localStorage.setItem('sourceSearch_sourceCategories', JSON.stringify(savedCategories));
    } catch (e) {
      console.error('[源站寻片] 保存源和分类失败:', e);
    }
  };

  // 从 localStorage 恢复源和分类
  const restoreSourceCategoryFromStorage = (source?: string): { source: string; category: string } => {
    try {
      if (typeof window === 'undefined') return { source: '', category: '' };
      
      const lastSource = localStorage.getItem('sourceSearch_lastSource') || '';
      const targetSource = source || lastSource;
      
      const savedCategoriesJson = localStorage.getItem('sourceSearch_sourceCategories') || '{}';
      const savedCategories = JSON.parse(savedCategoriesJson);
      const category = savedCategories[targetSource] || '';
      
      return { source: lastSource, category };
    } catch (e) {
      console.error('[源站寻片] 读取源和分类失败:', e);
      return { source: '', category: '' };
    }
  };

  // 镜像最新状态，供跳转播放页前保存快照
  useEffect(() => {
    snapshotRef.current = {
      apiSites,
      selectedSource,
      categories,
      selectedCategory,
      videos,
      // 当前页还在请求中，回退一页以便返回后重新拉取，避免缺页
      currentPage: isLoadingVideos && currentPage > 1 ? currentPage - 1 : currentPage,
      hasMore,
      viewMode,
      searchKeyword,
      searchInputValue,
      scrollTop: 0,
    };
  }, [
    apiSites,
    selectedSource,
    categories,
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
        SOURCE_SEARCH_STATE_KEY,
        JSON.stringify({ ...snapshot, scrollTop: getPageScrollTop() })
      );
    } catch {
      // 忽略 sessionStorage 写入失败（如超出配额）
    }
  }, []);

  // 加载用户可用的视频源
  useEffect(() => {
    if (!restoreChecked) return;

    const fetchApiSites = async () => {
      setIsLoadingSources(true);
      try {
        const response = await fetch(appendSpecialSourceParam('/api/source-search/sources'));
        const data = await response.json();
        if (data.sources && Array.isArray(data.sources)) {
          setApiSites(data.sources);
          
          const saved = restoreSourceCategoryFromStorage();
          const hasSource = (key: string) =>
            !!key && data.sources.some((s: ApiSite) => s.key === key);

          // 观影返回的快照源优先，其次是上次记住的源，最后回退到第一个源
          let effectiveSource = '';
          if (hasSource(selectedSource)) {
            effectiveSource = selectedSource;
          } else if (hasSource(saved.source)) {
            effectiveSource = saved.source;
          } else if (data.sources.length > 0) {
            effectiveSource = data.sources[0].key;
          }

          if (effectiveSource) {
            setSelectedSource(effectiveSource);
            setShowCategoryDropdown(true);
            const sourceItem = data.sources.find(
              (s: ApiSite) => s.key === effectiveSource
            );
            if (sourceItem) {
              setSelectedSourceName(sourceItem.name);
            }
          }
        }
      } catch (error) {
        console.error('[源站寻片] 加载源失败:', error);
      } finally {
        setIsLoadingSources(false);
      }
    };

    fetchApiSites();
  }, [restoreChecked]);

  // 当选择的源变化时，加载分类列表
  useEffect(() => {
    if (!restoreChecked || !selectedSource) return;

    // 恢复场景下分类与列表都来自快照，无需重新拉取
    if (skipCategoryFetchRef.current) {
      skipCategoryFetchRef.current = false;
      setIsInitialized(true);
      return;
    }

    const fetchCategories = async () => {
      setIsLoadingCategories(true);
      setCategories([]);
      setVideos([]);
      setCurrentPage(1);
      setHasMore(true);
      
      try {
        const response = await fetch(
          appendSpecialSourceParam(`/api/source-search/categories?source=${encodeURIComponent(selectedSource)}`)
        );
        const data = await response.json();
        if (data.categories && Array.isArray(data.categories)) {
          setCategories(data.categories);

          // 恢复该源对应的分类
          const saved = restoreSourceCategoryFromStorage(selectedSource);
          const savedCategoryExists = data.categories.some((c: Category) => c.id === saved.category);

          if (savedCategoryExists && saved.category) {
            setSelectedCategory(saved.category);
          } else if (data.categories.length > 0) {
            setSelectedCategory(data.categories[0].id);
          }

          // 只有在分类加载并尝试恢复后，才标记为已初始化
          setIsInitialized(true);
        }
      } catch (error) {
        console.error('[源站寻片] 加载分类失败:', error);
      } finally {
        setIsLoadingCategories(false);
      }
    };

    fetchCategories();
  }, [restoreChecked, selectedSource]);

  // 当选择的分类变化时，保存到 localStorage
  useEffect(() => {
    if (isInitialized && selectedSource && selectedCategory) {
      saveSourceCategoryToStorage(selectedSource, selectedCategory);
    }
  }, [selectedSource, selectedCategory, isInitialized]);

  // 当选择的分类或页码变化时，加载视频列表（浏览模式）
  useEffect(() => {
    if (!restoreChecked || viewMode !== 'browse' || !selectedSource || !selectedCategory)
      return;

    // 恢复场景下列表已来自快照，跳过本次请求
    if (skipVideoFetchRef.current) {
      skipVideoFetchRef.current = false;
      return;
    }

    const fetchVideos = async () => {
      setIsLoadingVideos(true);
      try {
        const response = await fetch(
          appendSpecialSourceParam(`/api/source-search/videos?source=${encodeURIComponent(selectedSource)}&categoryId=${encodeURIComponent(selectedCategory)}&page=${currentPage}`)
        );
        const data = await response.json();
        if (data.results && Array.isArray(data.results)) {
          if (currentPage === 1) {
            setVideos(data.results);
          } else {
            setVideos((prev) => [...prev, ...data.results]);
          }
          setHasMore(data.page < data.pageCount);
        }
      } catch (error) {
        console.error('Failed to load videos:', error);
      } finally {
        setIsLoadingVideos(false);
      }
    };

    fetchVideos();
  }, [restoreChecked, selectedSource, selectedCategory, currentPage, viewMode]);

  // 搜索视频函数（可在外部调用）
  const searchVideos = useCallback(async () => {
    if (!selectedSource || !searchKeyword) return;
    setIsLoadingVideos(true);
    try {
      const response = await fetch(
        appendSpecialSourceParam(`/api/source-search/search?source=${encodeURIComponent(selectedSource)}&keyword=${encodeURIComponent(searchKeyword)}&page=${currentPage}`)
      );
      const data = await response.json();
      if (data.results && Array.isArray(data.results)) {
        if (currentPage === 1) {
          setVideos(data.results);
        } else {
          setVideos((prev) => [...prev, ...data.results]);
        }
        setHasMore(data.page < data.pageCount);
      }
    } catch (error) {
      console.error('Failed to search videos:', error);
    } finally {
      setIsLoadingVideos(false);
    }
  }, [selectedSource, searchKeyword, currentPage]);

  // 当搜索关键词或页码变化时，执行搜索（搜索模式）
  useEffect(() => {
    if (!restoreChecked || viewMode !== 'search' || !selectedSource || !searchKeyword)
      return;

    // 恢复场景下列表已来自快照，跳过本次请求
    if (skipVideoFetchRef.current) {
      skipVideoFetchRef.current = false;
      return;
    }

    searchVideos();
  }, [restoreChecked, viewMode, selectedSource, searchKeyword, searchVideos, currentPage]);

  // 处理搜索提交
  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchInputValue.trim()) {
      setSearchKeyword(searchInputValue.trim());
      setViewMode('search');
      setCurrentPage(1);
      setVideos([]);
      setHasMore(true);
      setShowCategoryDropdown(false);
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
    setShowCategoryDropdown(true);
  };

  // 处理源选择
  const handleSourceChange = (value: string, name: string) => {
    // 立即重置初始化状态和分类，防止在加载新源分类前误保存旧分类
    setIsInitialized(false);
    setSelectedCategory('');
    
    setSelectedSource(value);
    setSelectedSourceName(name);
    setShowCategoryDropdown(true);

    // 如果当前是搜索模式，保留搜索关键词在新源搜索
    if (viewMode === 'search' && searchKeyword) {
      setVideos([]);
      setHasMore(true);
      setCurrentPage(1);
      // 触发搜索
      setTimeout(() => {
        searchVideos();
      }, 100);
    } else {
      // 浏览模式下才清空搜索
      handleBackToBrowse();
    }
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
      <div className="fixed inset-0 -z-10 overflow-hidden pointer-events-none">
        <div className="absolute top-0 -left-40 w-80 h-80 bg-indigo-500/20 rounded-full blur-3xl" />
        <div className="absolute top-1/3 -right-40 w-96 h-96 bg-purple-500/15 rounded-full blur-3xl" />
        <div className="absolute -bottom-40 left-1/3 w-80 h-80 bg-blue-500/15 rounded-full blur-3xl" />
      </div>

      <div className='px-4 sm:px-10 py-6 sm:py-10 overflow-visible mb-10 relative'>
        {/* 页面标题 - 移到左上角 */}
        <div className='mb-6'>
          <h1 className='text-2xl font-bold text-indigo-600 dark:text-indigo-400 mb-1'>
            源站寻片
          </h1>
          <p className='text-sm text-gray-500 dark:text-gray-400'>
            根据可用视频源浏览分类内容，畅享海量视频
          </p>
        </div>

        {/* 搜索框 */}
        <div className='mb-6'>
          <form onSubmit={handleSearch}>
            <div className="relative group">
              <div className="absolute inset-0 bg-gradient-to-r from-indigo-500/20 via-purple-500/20 to-blue-500/20 rounded-xl blur-xl group-hover:blur-2xl transition-all duration-500 opacity-50" />
              <div className="relative flex items-center">
                <input
                  type='text'
                  value={searchInputValue}
                  onChange={(e) => setSearchInputValue(e.target.value)}
                  placeholder='搜索视频...'
                  className='w-full h-12 rounded-xl bg-white/80 dark:bg-gray-800/80 backdrop-blur-xl py-3 pl-5 pr-14 text-sm text-gray-700 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-400/50 focus:bg-white dark:focus:bg-gray-700 border border-gray-200/50 dark:border-gray-700/50 shadow-lg transition-all'
                />
                <button
                  type='submit'
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
              <div className="flex items-center gap-2">
                <SearchX className="h-4 w-4 text-indigo-500" />
                <span className='text-sm text-gray-700 dark:text-gray-300'>
                  搜索结果: <span className='font-semibold text-indigo-600 dark:text-indigo-400'>{searchKeyword}</span>
                </span>
              </div>
              <button
                type="button"
                onClick={handleBackToBrowse}
                className='text-sm text-indigo-600 hover:text-indigo-700 dark:text-indigo-400 dark:hover:text-indigo-300 font-medium'
              >
                返回分类浏览
              </button>
            </div>
          </div>
        )}

        {/* 源选择 + 分类 */}
        <div className='mb-8'>
          <div className='bg-white/60 dark:bg-gray-800/40 rounded-2xl p-4 sm:p-6 border border-gray-200/30 dark:border-gray-700/30 backdrop-blur-sm'>
            {/* 源选择器：带过滤搜索框，列表左对齐 */}
            <div className='mb-3'>
              <div className='flex items-center justify-between gap-3 mb-3'>
                <label className='block text-sm font-medium text-gray-700 dark:text-gray-300'>
                  选择视频源
                </label>
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
                    className={`w-full h-9 pr-3 text-sm bg-transparent border-0 focus:outline-none focus:ring-0 text-gray-700 dark:text-gray-300 placeholder:text-gray-400 dark:placeholder:text-gray-500 transition-opacity duration-300 ${
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
                    onChange={(value) => {
                      const site = apiSites.find((s) => s.key === value);
                      handleSourceChange(value, site?.name || '');
                    }}
                  />
                </div>
              )}
            </div>

            {/* 分类选择器 */}
            <div>
              {isLoadingCategories ? (
                <div className="flex items-center justify-center h-10">
                  <div className="flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin text-indigo-500" />
                    <span className="text-sm text-gray-500 dark:text-gray-400">加载分类中...</span>
                  </div>
                </div>
              ) : categories.length === 0 ? (
                <div className="flex items-center justify-center h-10">
                  <span className="text-sm text-gray-500 dark:text-gray-400">暂无可用分类</span>
                </div>
              ) : (
                <CapsuleSwitch
                  options={categories.map((category) => ({
                    label: category.name,
                    value: category.id,
                  }))}
                  active={selectedCategory}
                  onChange={(categoryId) => {
                    // 重置分页状态，确保切换分类后能正常加载
                    setCurrentPage(1);
                    setHasMore(true);
                    setVideos([]);
                    setSelectedCategory(categoryId);
                  }}
                />
              )}
            </div>
          </div>
        </div>

        {/* 视频列表 */}
        {selectedSource && (viewMode === 'search' ? searchKeyword : selectedCategory) && (
          <div className='max-w-[95%] mx-auto mt-8'>
            {/* 标题区域 */}
            <div className="flex items-center gap-3 mb-6">
              <div className="h-px flex-1 bg-gradient-to-r from-transparent via-indigo-300/50 to-transparent dark:via-indigo-700/50" />
              <h2 className='text-xl font-bold text-gray-800 dark:text-gray-200 px-4'>
                {viewMode === 'search' ? '搜索结果' : '视频列表'}
              </h2>
              <div className="h-px flex-1 bg-gradient-to-r from-transparent via-indigo-300/50 to-transparent dark:via-indigo-700/50" />
            </div>

            {isLoadingVideos && currentPage === 1 ? (
              <VideoSkeleton />
            ) : videos.length === 0 ? (
              <div className='flex flex-col items-center justify-center py-16 bg-white/40 dark:bg-gray-800/40 backdrop-blur-xl rounded-2xl border border-gray-200/50 dark:border-gray-700/50 shadow-xl'>
                <SearchX className="h-16 w-16 text-gray-300 dark:text-gray-600 mb-4" />
                <p className='text-lg text-gray-500 dark:text-gray-400 mb-2'>暂无视频</p>
                <p className='text-sm text-gray-400 dark:text-gray-500'>试试其他分类或搜索关键词</p>
              </div>
            ) : (
              <>
                <div className='grid grid-cols-3 gap-x-2 gap-y-14 sm:gap-y-20 px-0 sm:px-2 sm:grid-cols-[repeat(auto-fill,_minmax(11rem,_1fr))] sm:gap-x-8'>
                  {videos.map((item) => (
                    <div
                      key={`${item.source}-${item.id}`}
                      className='w-full transform transition-all duration-300 hover:scale-[1.02]'
                    >
                      <VideoCard
                        id={item.id}
                        title={item.title}
                        poster={item.poster}
                        episodes={item.episodes.length}
                        source={item.source}
                        source_name={item.source_name}
                        douban_id={item.douban_id}
                        year={item.year}
                        from='source-search'
                        type={item.episodes.length > 1 ? 'tv' : 'movie'}
                        isAnime={isAnimeCategoryText(
                          item.type_name,
                          item.class
                        )}
                        typeName={item.type_name || item.class}
                        cmsData={{
                          desc: item.desc,
                          episodes: item.episodes,
                          episodes_titles: item.episodes_titles,
                        }}
                        onBeforeNavigate={saveSnapshot}
                      />
                    </div>
                  ))}
                </div>

                {/* Infinite scroll trigger */}
                <div ref={loadMoreRef} className='flex justify-center items-center py-10'>
                  {isLoadingVideos && (
                    <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400">
                      <Loader2 className="h-5 w-5 animate-spin text-indigo-500" />
                      <span className="text-sm">加载更多...</span>
                    </div>
                  )}
                  {!hasMore && videos.length > 0 && (
                    <div className="flex items-center gap-2 text-sm text-gray-400 dark:text-gray-500">
                      <div className="h-px w-12 bg-gradient-to-r from-transparent via-gray-300/50 to-transparent dark:via-gray-700/50" />
                      <span>没有更多了</span>
                      <div className="h-px w-12 bg-gradient-to-r from-transparent via-gray-300/50 to-transparent dark:via-gray-700/50" />
                    </div>
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
