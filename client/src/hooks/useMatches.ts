import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { fetchMatches, fetchPickOfDay, fetchPerformance, fetchDailyPL, fetchSettled, fetchPotdHistory, fetchEvPick, fetchEvPickHistory } from '../api/client';
import { todayString } from '../lib/routing';

export function useMatches(date: string) {
  return useQuery({
    queryKey: ['matches', date],
    queryFn: () => fetchMatches(date),
    enabled: !!date,
    refetchInterval: 90000,
    staleTime: 600000,
    placeholderData: keepPreviousData,
  });
}

export function usePickOfDay(date: string) {
  return useQuery({
    queryKey: ['pick-of-day', date],
    queryFn: () => fetchPickOfDay(date),
    enabled: !!date,
    refetchInterval: 90000,
    staleTime: 600000,
    placeholderData: keepPreviousData,
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
  const isToday = !!date && date === todayString();
  return useQuery({
    queryKey: ['daily-pl', date],
    queryFn: () => fetchDailyPL(date),
    enabled: !!date,
    refetchInterval: isToday ? 60000 : false,
    staleTime: 600000,
    placeholderData: keepPreviousData,
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
    queryFn: () => fetchPotdHistory(),
    refetchInterval: 300000,
  });
}

export function useEvPick(date: string) {
  return useQuery({
    queryKey: ['ev-pick', date],
    queryFn: () => fetchEvPick(date),
    enabled: !!date,
    refetchInterval: 90000,
    staleTime: 600000,
    placeholderData: keepPreviousData,
  });
}

export function useEvPickHistory() {
  return useQuery({
    queryKey: ['ev-pick-history'],
    queryFn: () => fetchEvPickHistory(),
    refetchInterval: 300000,
  });
}

