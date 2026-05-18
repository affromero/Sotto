'use client';

import { useState, useCallback, useRef } from 'react';
import { SearchBar } from '@/components/feed/SearchBar';
import { VoiceMarketplaceCard } from '@/components/voices/VoiceMarketplaceCard';
import type { BrowseVoice } from '@/components/voices/VoiceMarketplaceCard';
import cardStyles from './VoicesClient.module.css';

interface VoicesClientProps {
  initialVoices: BrowseVoice[];
  totalVoices: number;
  currentUserId: string | null;
  isAuthenticated: boolean;
}

type SortOption = 'newest' | 'most_requested';
type PricingFilter = 'all' | 'free' | 'paid';

export function VoicesClient({
  initialVoices,
  totalVoices,
  currentUserId,
  isAuthenticated,
}: VoicesClientProps) {
  const [voices, setVoices] = useState<BrowseVoice[]>(initialVoices);
  const [total, setTotal] = useState(totalVoices);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SortOption>('newest');
  const [pricing, setPricing] = useState<PricingFilter>('all');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchVoices = useCallback(
    async (params: { search?: string; sort?: SortOption; pricing?: PricingFilter; page?: number; append?: boolean }) => {
      const isAppend = params.append ?? false;
      if (isAppend) {
        setLoadingMore(true);
      } else {
        setLoading(true);
      }

      try {
        const searchParams = new URLSearchParams();
        if (params.search) searchParams.set('search', params.search);
        searchParams.set('sort', params.sort ?? sort);
        const pricingValue = params.pricing ?? pricing;
        if (pricingValue !== 'all') searchParams.set('pricing', pricingValue);
        searchParams.set('page', String(params.page ?? 1));
        searchParams.set('limit', '24');

        const response = await fetch(`/api/voices/browse?${searchParams}`);
        if (!response.ok) return;

        const data = await response.json();
        if (isAppend) {
          setVoices((prev) => [...prev, ...data.voices]);
        } else {
          setVoices(data.voices);
        }
        setTotal(data.total);
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [sort, pricing]
  );

  function handleSearchChange(value: string) {
    setSearch(value);
    setPage(1);

    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    searchTimeoutRef.current = setTimeout(() => {
      fetchVoices({ search: value, page: 1 });
    }, 300);
  }

  function handleSortChange(newSort: SortOption) {
    if (newSort === sort) return;
    setSort(newSort);
    setPage(1);
    fetchVoices({ search, sort: newSort, pricing, page: 1 });
  }

  function handlePricingChange(newPricing: PricingFilter) {
    if (newPricing === pricing) return;
    setPricing(newPricing);
    setPage(1);
    fetchVoices({ search, sort, pricing: newPricing, page: 1 });
  }

  function handleLoadMore() {
    const nextPage = page + 1;
    setPage(nextPage);
    fetchVoices({ search, pricing, page: nextPage, append: true });
  }

  function handleRequestStatusChange(voiceId: string, status: string) {
    setVoices((prev) =>
      prev.map((v) => (v.id === voiceId ? { ...v, requestStatus: status } : v))
    );
  }

  const hasMore = voices.length < total;

  return (
    <div className={cardStyles.wrapper}>
      <header className={cardStyles.header}>
        <h1 className={cardStyles.title}>Shared Voices</h1>
        <p className={cardStyles.subtitle}>
          Browse verified voices and request explicit access to use them in your podcasts.
        </p>
      </header>

      <div className={cardStyles.controls}>
        <div className={cardStyles.searchRow}>
          <SearchBar
            value={search}
            onChange={handleSearchChange}
            placeholder="Search voices..."
          />
        </div>
        <div className={cardStyles.sortRow}>
          <span className={cardStyles.sortLabel}>Sort</span>
          <div className={cardStyles.pillGroup}>
            <button
              type="button"
              className={`${cardStyles.pill} ${sort === 'newest' ? cardStyles.pillActive : ''}`}
              onClick={() => handleSortChange('newest')}
            >
              Newest
            </button>
            <button
              type="button"
              className={`${cardStyles.pill} ${sort === 'most_requested' ? cardStyles.pillActive : ''}`}
              onClick={() => handleSortChange('most_requested')}
            >
              Most Requested
            </button>
          </div>
        </div>
        <div className={cardStyles.sortRow}>
          <span className={cardStyles.sortLabel}>Pricing</span>
          <div className={cardStyles.pillGroup}>
            <button
              type="button"
              className={`${cardStyles.pill} ${pricing === 'all' ? cardStyles.pillActive : ''}`}
              onClick={() => handlePricingChange('all')}
            >
              All
            </button>
            <button
              type="button"
              className={`${cardStyles.pill} ${pricing === 'free' ? cardStyles.pillActive : ''}`}
              onClick={() => handlePricingChange('free')}
            >
              Free
            </button>
            <button
              type="button"
              className={`${cardStyles.pill} ${pricing === 'paid' ? cardStyles.pillActive : ''}`}
              onClick={() => handlePricingChange('paid')}
            >
              Paid
            </button>
          </div>
        </div>
      </div>

      {loading ? (
        <div className={cardStyles.grid}>
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className={cardStyles.skeleton}>
              <div className={cardStyles.skeletonAvatar} />
              <div className={cardStyles.skeletonLines}>
                <div className={cardStyles.skeletonLine} />
                <div className={`${cardStyles.skeletonLine} ${cardStyles.skeletonLineShort}`} />
              </div>
            </div>
          ))}
        </div>
      ) : voices.length === 0 ? (
        <div className={cardStyles.empty}>
          <p className={cardStyles.emptyTitle}>
            {search ? 'No voices found' : 'No voices available yet'}
          </p>
          <p className={cardStyles.emptyText}>
            {search
              ? 'Try adjusting your search.'
              : 'Be the first to share your voice clone with the community.'}
          </p>
        </div>
      ) : (
        <>
          <div className={cardStyles.grid}>
            {voices.map((voice) => (
              <VoiceMarketplaceCard
                key={voice.id}
                voice={voice}
                currentUserId={currentUserId}
                isAuthenticated={isAuthenticated}
                onRequestStatusChange={handleRequestStatusChange}
              />
            ))}
          </div>

          {hasMore && (
            <div className={cardStyles.loadMoreRow}>
              <button
                type="button"
                className={cardStyles.loadMoreBtn}
                onClick={handleLoadMore}
                disabled={loadingMore}
              >
                {loadingMore ? 'Loading...' : 'Load More'}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
