import { useState } from 'react';
import dayjs from 'dayjs';
import DatePicker from './components/DatePicker';
import PickOfDayCard from './components/PickOfDayCard';
import MatchTable from './components/MatchTable';
import PerformancePanel from './components/PerformancePanel';
import { useMatches, usePickOfDay, usePerformance } from './hooks/useMatches';

export default function App() {
  const [date, setDate] = useState(dayjs().format('YYYY-MM-DD'));
  const { data: matchData, isLoading: matchesLoading } = useMatches(date);
  const { data: pickData, isLoading: pickLoading } = usePickOfDay(date);
  const { data: perfData } = usePerformance(30);

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg-primary)' }}>
      {/* Header */}
      <header className="border-b" style={{ borderColor: 'var(--border)', background: 'var(--bg-secondary)' }}>
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
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

      <main className="max-w-7xl mx-auto px-4 py-6 space-y-6">
        {/* Performance Stats */}
        {perfData && <PerformancePanel data={perfData} />}

        {/* Pick of the Day */}
        <PickOfDayCard data={pickData} loading={pickLoading} />

        {/* Match Table */}
        <MatchTable
          matches={matchData?.matches || []}
          loading={matchesLoading}
          date={date}
        />
      </main>
    </div>
  );
}
