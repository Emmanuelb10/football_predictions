import { useQuery } from '@tanstack/react-query';
import { fetchMatches, fetchPickOfDay, fetchPerformance } from '../api/client';

export function useMatches(date: string) {
  return useQuery({
    queryKey: ['matches', date],
    queryFn: () => fetchMatches(date),
    refetchInterval: 60000, // Refetch every minute
  });
}

export function usePickOfDay(date: string) {
  return useQuery({
    queryKey: ['pick-of-day', date],
    queryFn: () => fetchPickOfDay(date),
    enabled: !!date,
    refetchInterval: 60000,
  });
}

export function usePerformance(days: number = 30) {
  return useQuery({
    queryKey: ['performance', days],
    queryFn: () => fetchPerformance(days),
    refetchInterval: 300000, // Refetch every 5 minutes
  });
}
