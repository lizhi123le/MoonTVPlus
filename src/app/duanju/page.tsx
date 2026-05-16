/* eslint-disable @typescript-eslint/no-explicit-any, react-hooks/exhaustive-deps */
'use client';

import { Loader2 } from 'lucide-react';
import { Suspense, useEffect, useRef, useState } from 'react';

import { SearchResult } from '@/lib/types';

import CapsuleSwitch from '@/components/CapsuleSwitch';
import PageLayout from '@/components/PageLayout';
import VideoCard from '@/components/VideoCard';

interface DuanjuSource {
  key: string;
  name: string;
  api: string;
  typeId?: string;
  typeName?: string;
}

function DuanjuPageClient() {
  const [sources, setSources] = useState<DuanjuSource[]>([]);
  const [selectedSource, setSelectedSource] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('');
  const [videos, setVideos] = useState<SearchResult[]>([]);
  const [isLoadingSources, setIsLoadingSources] = useState(true);
  const [isLoadingVideos, setIsLoadingVideos] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const [isInitialized, setIsInitialized] = useState(false);

  // 保存来源到 localStorage
  const saveSourceToStorage = (source: string) => {
    if (!isInitialized) return;
    try {
      localStorage.setItem('duanju_lastSource', source);
    } catch (e) {
      console.error('[短剧] 保存来源失败:', e);
    }
  };

  // 从 localStorage 恢复来源
  const restoreSourceFromStorage = (): string => {
    try {
      if (typeof window === 'undefined') return '';
      return localStorage.getItem('duanju_lastSource') || '';
    } catch (e) {
      console.error('[短剧] 读取来源失败:', e);
      return '';
    }
  };

  useEffect(() => {
    const fetchSources = async () => {
      setIsLoadingSources(true);
      try {
        const response = await fetch('/api/duanju/sources');
        const data = await response.json();
        if (data.code === 200 && Array.isArray(data.data)) {
          setSources(data.data);
          if (data.data.length > 0) {
            const savedSource = restoreSourceFromStorage();
            const sourceExists = data.data.some((s: DuanjuSource) => s.key === savedSource);
            
            if (sourceExists && savedSource) {
              const source = data.data.find((s: DuanjuSource) => s.key === savedSource);
              setSelectedSource(savedSource);
              setSelectedCategory(source?.typeId || '');
            } else {
              setSelectedSource(data.data[0].key);
              setSelectedCategory(data.data[0].typeId || '');
            }
            setIsInitialized(true);
          }
        }
      } catch (error) {
        console.error('Failed to load duanju sources:', error);
      } finally {
        setIsLoadingSources(false);
      }
    };

    fetchSources();
  }, []);

  const handleSourceChange = (sourceKey: string) => {
    const source = sources.find((item) => item.key === sourceKey);
    setSelectedSource(sourceKey);
    setSelectedCategory(source?.typeId || '');
    setCurrentPage(1);
    setVideos([]);
    setHasMore(true);
    saveSourceToStorage(sourceKey);
  };

  useEffect(() => {
    if (!selectedSource || !selectedCategory) return;

    const fetchVideos = async () => {
      setIsLoadingVideos(true);
      try {
        const response = await fetch(
          `/api/duanju/videos?source=${encodeURIComponent(selectedSource)}&categoryId=${encodeURIComponent(selectedCategory)}&page=${currentPage}`
        );
        const data = await response.json();
        if (data.code === 200 && Array.isArray(data.data)) {
          if (currentPage === 1) {
            setVideos(data.data);
          } else {
            setVideos((prev) => [...prev, ...data.data]);
          }
          setHasMore(data.page < data.pageCount);
        }
      } catch (error) {
        console.error('Failed to load duanju videos:', error);
      } finally {
        setIsLoadingVideos(false);
      }
    };

    fetchVideos();
  }, [selectedSource, selectedCategory, currentPage]);

  useEffect(() => {
    if (!loadMoreRef.current) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const target = entries[0];
        if (target.isIntersecting && hasMore && !isLoadingVideos) {
          setCurrentPage((prev) => prev + 1);
        }
      },
      { rootMargin: '240px 0px', threshold: 0.1 }
    );

    observer.observe(loadMoreRef.current);

    return () => {
      observer.disconnect();
    };
  }, [hasMore, isLoadingVideos]);

  return (
    <PageLayout activePath='/duanju'>
      <div className='px-4 sm:px-10 py-4 sm:py-8 overflow-visible mb-10'>
        <div className='mb-6'>
          <h1 className='text-2xl font-bold text-gray-800 dark:text-gray-200'>
            短剧
          </h1>
          <p className='text-sm text-gray-500 dark:text-gray-400 mt-1'>
            浏览所有采集源中的短剧内容
          </p>
        </div>

        <div className='max-w-[95%] mx-auto mb-8'>
          <div className='relative'>
            {isLoadingSources ? (
              <div className='flex items-center justify-center h-12 bg-gray-50/80 rounded-lg border border-gray-200/50 dark:bg-gray-800 dark:border-gray-700'>
                <Loader2 className='h-5 w-5 animate-spin text-gray-400' />
                <span className='ml-2 text-sm text-gray-500 dark:text-gray-400'>
                  加载采集源中...
                </span>
              </div>
            ) : sources.length === 0 ? (
              <div className='flex items-center justify-center h-12 bg-gray-50/80 rounded-lg border border-gray-200/50 dark:bg-gray-800 dark:border-gray-700'>
                <span className='text-sm text-gray-500 dark:text-gray-400'>
                  暂无包含短剧分类的采集源
                </span>
              </div>
            ) : (
              <div className='flex justify-center'>
                <CapsuleSwitch
                  options={sources.map((source) => ({
                    label: source.name,
                    value: source.key,
                  }))}
                  active={selectedSource}
                  onChange={handleSourceChange}
                />
              </div>
            )}
          </div>
        </div>

        {selectedSource && !selectedCategory && (
          <div className='text-center text-gray-500 py-8 dark:text-gray-400'>
            当前采集源暂无短剧分类
          </div>
        )}

        {selectedSource && selectedCategory && (
          <div className='max-w-[95%] mx-auto mt-8'>
            <div className='mb-4'>
              <h2 className='text-xl font-bold text-gray-800 dark:text-gray-200'>
                短剧列表
              </h2>
            </div>

            {isLoadingVideos && currentPage === 1 ? (
              <div className='flex justify-center items-center h-40'>
                <div className='animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500'></div>
              </div>
            ) : videos.length === 0 ? (
              <div className='text-center text-gray-500 py-8 dark:text-gray-400'>
                暂无短剧
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
                        episodes={item.episodes.length}
                        source={item.source}
                        source_name={item.source_name}
                        douban_id={item.douban_id}
                        year={item.year}
                        from='source-search'
                        type='tv'
                        cmsData={{
                          desc: item.desc,
                          episodes: item.episodes,
                          episodes_titles: item.episodes_titles,
                        }}
                      />
                    </div>
                  ))}
                </div>

                <div ref={loadMoreRef} className='flex justify-center items-center py-8'>
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
    </PageLayout>
  );
}

export default function DuanjuPage() {
  return (
    <Suspense>
      <DuanjuPageClient />
    </Suspense>
  );
}
