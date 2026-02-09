/* eslint-disable @typescript-eslint/no-explicit-any, react-hooks/exhaustive-deps */
'use client';

import { Globe2, Loader2, Search, SearchX, Sparkles } from 'lucide-react';
import { Suspense, useEffect, useRef, useState } from 'react';

import { ApiSite } from '@/lib/config';
import { SearchResult } from '@/lib/types';

import CapsuleSwitch from '@/components/CapsuleSwitch';
import PageLayout from '@/components/PageLayout';
import VideoCard from '@/components/VideoCard';

interface Category {
  id: string;
  name: string;
}

type ViewMode = 'browse' | 'search';

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
  const loadMoreRef = useRef<HTMLDivElement>(null);

  // 加载用户可用的视频源
  useEffect(() => {
    const fetchApiSites = async () => {
      setIsLoadingSources(true);
      try {
        const response = await fetch('/api/source-search/sources');
        const data = await response.json();
        if (data.sources && Array.isArray(data.sources)) {
          setApiSites(data.sources);
          // 默认选择第一个源，并显示分类下拉
          if (data.sources.length > 0) {
            setSelectedSource(data.sources[0].key);
            setSelectedSourceName(data.sources[0].name);
            setShowCategoryDropdown(true);
          }
        }
      } catch (error) {
        console.error('Failed to load API sources:', error);
      } finally {
        setIsLoadingSources(false);
      }
    };

    fetchApiSites();
  }, []);

  // 当选择的源变化时，加载分类列表
  useEffect(() => {
    if (!selectedSource) return;

    const fetchCategories = async () => {
      setIsLoadingCategories(true);
      setCategories([]);
      setSelectedCategory('');
      setVideos([]);
      setCurrentPage(1);
      setHasMore(true);
      try {
        const response = await fetch(
          `/api/source-search/categories?source=${encodeURIComponent(selectedSource)}`
        );
        const data = await response.json();
        if (data.categories && Array.isArray(data.categories)) {
          setCategories(data.categories);
          // 默认选择第一个分类
          if (data.categories.length > 0) {
            setSelectedCategory(data.categories[0].id);
          }
        }
      } catch (error) {
        console.error('Failed to load categories:', error);
      } finally {
        setIsLoadingCategories(false);
      }
    };

    fetchCategories();
  }, [selectedSource]);

  // 当选择的分类或页码变化时，加载视频列表（浏览模式）
  useEffect(() => {
    if (viewMode !== 'browse' || !selectedSource || !selectedCategory) return;

    const fetchVideos = async () => {
      setIsLoadingVideos(true);
      try {
        const response = await fetch(
          `/api/source-search/videos?source=${encodeURIComponent(selectedSource)}&categoryId=${encodeURIComponent(selectedCategory)}&page=${currentPage}`
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
  }, [selectedSource, selectedCategory, currentPage, viewMode]);

  // 搜索视频函数（可在外部调用）
  const searchVideos = useCallback(async () => {
    if (!selectedSource || !searchKeyword) return;
    setIsLoadingVideos(true);
    try {
      const response = await fetch(
        `/api/source-search/search?source=${encodeURIComponent(selectedSource)}&keyword=${encodeURIComponent(searchKeyword)}&page=${currentPage}`
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
  }, [selectedSource, searchKeyword]); // currentPage 由 useEffect 闭包捕获

  // 当搜索关键词或页码变化时，执行搜索（搜索模式）
  useEffect(() => {
    if (viewMode !== 'search' || !selectedSource || !searchKeyword) return;
    searchVideos();
  }, [viewMode, selectedSource, searchKeyword, searchVideos]);

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
  useEffect(() => {
    if (!loadMoreRef.current) return;

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
  }, [hasMore, isLoadingVideos]);

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
            {/* 源选择器 */}
            <div className="mb-3">
              <CapsuleSwitch
                options={apiSites.map((site) => ({
                  label: site.name,
                  value: site.key,
                }))}
                active={selectedSource}
                onChange={(value) => {
                  const site = apiSites.find(s => s.key === value);
                  handleSourceChange(value, site?.name || '');
                }}
              />
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
                  onChange={setSelectedCategory}
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
                        cmsData={{
                          desc: item.desc,
                          episodes: item.episodes,
                          episodes_titles: item.episodes_titles,
                        }}
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
