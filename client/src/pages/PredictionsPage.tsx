import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import DatePicker from '../components/DatePicker';
import PickOfDayCard from '../components/PickOfDayCard';
import MatchTable from '../components/MatchTable';
import DailyPLBanner from '../components/DailyPLBanner';
import AccumulatorCard from '../components/AccumulatorCard';
import PotdHistory from '../components/PotdHistory';
import Glossary from '../components/Glossary';
import { useToast } from '../components/ToastContainer';
import { useMatches, usePickOfDay, useDailyPL, useAccumulators, useSettled, usePotdHistory } from '../hooks/useMatches';
import { isValidDateParam } from '../lib/routing';
import NotFound from './NotFound';

export default function PredictionsPage() {
  const navigate = useNavigate();
  const { date: dateParam } = useParams();
  const validation = useMemo(() => isValidDateParam(dateParam), [dateParam]);

  // All hooks below MUST run unconditionally to preserve hook order across
  // valid/invalid renders. When validation fails, we pass an empty string so
  // React Query is disabled via `!!date` / `enabled: !!date` checks.
  const date = validation.valid ? validation.date : '';
  const { data: matchData, isLoading: matchesLoading, isFetching } = useMatches(date);
  const { data: pickData, isLoading: pickLoading } = usePickOfDay(
    matchData?.matches?.length !== undefined ? date : ''
  );
  const { data: dailyPL } = useDailyPL(date);
  const { data: accData } = useAccumulators(matchData?.matches?.length ? date : '');
  const { data: settledData } = useSettled();
  const { data: potdHistoryData } = usePotdHistory();
  const { addToast } = useToast();

  const settledIds = useMemo(() => {
    const ids = new Set<number>();
    settledData?.settled?.forEach((s: any) => ids.add(s.id));
    return ids;
  }, [settledData]);

  // Track date changes (used to gate the success toast below).
  // The previous "Fetching predictions for..." in-progress toast was removed to
  // avoid visual spam during rapid arrow-click navigation.
  const [prevDate, setPrevDate] = useState('');
  useEffect(() => {
    if (date && date !== prevDate) {
      setPrevDate(date);
    }
  }, [date, prevDate]);

  useEffect(() => {
    if (date && matchData?.matches?.length && !isFetching && date === prevDate) {
      const valueBets = matchData.matches.filter((m: any) => m.is_value_bet).length;
      if (valueBets > 0) {
        addToast(`${matchData.matches.length} matches loaded, ${valueBets} value bets found`, 'success');
      }
    }
  }, [matchData?.matches?.length, isFetching]);

  if (!validation.valid) {
    return <NotFound reason={validation.reason} />;
  }

  const onArrowChange = (d: string) => navigate(`/${d}`, { replace: true });
  const onPickerChange = (d: string) => navigate(`/${d}`);

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg-primary)' }}>
      <header className="border-b" style={{ borderColor: 'var(--border)', background: 'var(--bg-secondary)' }}>
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <span className="text-2xl">&#9917;</span>
            <div>
              <h1 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>
                Football Predictions
              </h1>
              <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                Data-Driven Value Bet Finder
              </p>
            </div>
          </div>
          <DatePicker date={date} onArrowChange={onArrowChange} onPickerChange={onPickerChange} />
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-6 space-y-4">
        <PickOfDayCard data={pickData} loading={pickLoading} />
        <MatchTable
          matches={matchData?.matches || []}
          loading={matchesLoading}
          date={date}
          isFetching={isFetching}
          settledIds={settledIds}
        />
        <DailyPLBanner data={dailyPL} />
        <AccumulatorCard data={accData} />
        <PotdHistory data={potdHistoryData} />
        <Glossary />
      </main>
    </div>
  );
}
