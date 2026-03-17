import { useQuery } from '@tanstack/react-query';
import { fetchMatches, fetchPickOfDay, fetchPerformance, fetchDailyPL, fetchAccumulators, fetchSettled, fetchPotdHistory } from '../api/client';

export function useMatches(date: string) {
  return useQuery({
    queryKey: ['matches', date],
    queryFn: () => fetchMatches(date),
    refetchInterval: 90000,
    staleTime: 30000,
  });
}

export function usePickOfDay(date: string) {
  return useQuery({
    queryKey: ['pick-of-day', date],
    queryFn: () => fetchPickOfDay(date),
    enabled: !!date,
    refetchInterval: 90000,
  });
}

export function usePerformance(days: number = 30) {
  return useQuery({
    queryKey: ['performance', days],
    queryFn: () => fetchPerformance(days),
    refetchInterval: 300000,
  });
}

export function useDailyPL(date: string) {
  return useQuery({
    queryKey: ['daily-pl', date],
    queryFn: () => fetchDailyPL(date),
    enabled: !!date,
    refetchInterval: 60000,
  });
}

export function useAccumulators(date: string) {
  return useQuery({
    queryKey: ['accumulators', date],
    queryFn: () => fetchAccumulators(date),
    enabled: !!date,
    refetchInterval: 120000,
  });
}

export function useSettled() {
  return useQuery({
    queryKey: ['settled'],
    queryFn: () => fetchSettled(new Date(Date.now() - 300000).toISOString()),
    refetchInterval: 30000,
  });
}

export function usePotdHistory() {
  return useQuery({
    queryKey: ['potd-history'],
    queryFn: () => fetchPotdHistory(30),
    refetchInterval: 300000,
  });
}
