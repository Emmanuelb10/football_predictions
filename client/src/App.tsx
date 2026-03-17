import { useState, useEffect, useMemo } from 'react';
import dayjs from 'dayjs';
import DatePicker from './components/DatePicker';
import PickOfDayCard from './components/PickOfDayCard';
import MatchTable from './components/MatchTable';
import PerformancePanel from './components/PerformancePanel';
import DailyPLBanner from './components/DailyPLBanner';
import AccumulatorCard from './components/AccumulatorCard';
import PotdHistory from './components/PotdHistory';
import { useToast } from './components/ToastContainer';
import { useMatches, usePickOfDay, usePerformance, useDailyPL, useAccumulators, useSettled, usePotdHistory } from './hooks/useMatches';

export default function App() {
  const [date, setDate] = useState(dayjs().format('YYYY-MM-DD'));
  const { data: matchData, isLoading: matchesLoading, isFetching } = useMatches(date);
  const { data: pickData, isLoading: pickLoading } = usePickOfDay(
    matchData?.matches?.length !== undefined ? date : ''
  );
  const { data: perfData } = usePerformance(30);
  const { data: dailyPL } = useDailyPL(date);
  const { data: accData } = useAccumulators(matchData?.matches?.length ? date : '');
  const { data: settledData } = useSettled();
  const { data: potdHistoryData } = usePotdHistory();
  const { addToast } = useToast();

  // Track settled match IDs for flash animation
  const settledIds = useMemo(() => {
    const ids = new Set<number>();
    settledData?.settled?.forEach((s: any) => ids.add(s.id));
    return ids;
  }, [settledData]);

  // Toast notifications on data load
  const [prevDate, setPrevDate] = useState('');
  useEffect(() => {
    if (date !== prevDate) {
      setPrevDate(date);
      if (!matchesLoading && isFetching) {
        addToast(`Fetching predictions for ${dayjs(date).format('MMM D')}...`, 'info');
      }
    }
  }, [date, matchesLoading, isFetching]);

  useEffect(() => {
    if (matchData?.matches?.length && !isFetching && date === prevDate) {
      const valueBets = matchData.matches.filter((m: any) => m.is_value_bet).length;
      if (valueBets > 0) {
        addToast(`${matchData.matches.length} matches loaded, ${valueBets} value bets found`, 'success');
      }
    }
  }, [matchData?.matches?.length, isFetching]);

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg-primary)' }}>
      {/* Header */}
      <header className="border-b" style={{ borderColor: 'var(--border)', background: 'var(--bg-secondary)' }}>
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <span className="text-2xl">&#9917;</span>
            <div>
              <h1 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>
                Football Predictions
              </h1>
              <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                AI-Powered Value Bet Finder
              </p>
            </div>
          </div>
          <DatePicker date={date} onChange={setDate} />
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-6 space-y-4">
        {/* Daily P&L Banner */}
        <DailyPLBanner data={dailyPL} />

        {/* Performance Stats */}
        {perfData && <PerformancePanel data={perfData} />}

        {/* Pick of the Day */}
        <PickOfDayCard data={pickData} loading={pickLoading} />

        {/* Accumulator Suggestions */}
        <AccumulatorCard data={accData} />

        {/* Match Table with Tiers */}
        <MatchTable
          matches={matchData?.matches || []}
          loading={matchesLoading}
          date={date}
          isFetching={isFetching}
          settledIds={settledIds}
        />

        {/* POTD History Table */}
        <PotdHistory data={potdHistoryData} />
      </main>
    </div>
  );
}
