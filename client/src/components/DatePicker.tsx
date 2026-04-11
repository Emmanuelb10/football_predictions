import dayjs from 'dayjs';
import { LAUNCH_DATE, todayString } from '../lib/routing';

interface DatePickerProps {
  date: string;
  onArrowChange: (date: string) => void;   // prev/next arrow — replace history
  onPickerChange: (date: string) => void;  // native picker + Today button — push history
}

export default function DatePicker({ date, onArrowChange, onPickerChange }: DatePickerProps) {
  const prevDate = dayjs(date).subtract(1, 'day').format('YYYY-MM-DD');
  const prev = () => { if (prevDate >= LAUNCH_DATE) onArrowChange(prevDate); };
  const next = () => onArrowChange(dayjs(date).add(1, 'day').format('YYYY-MM-DD'));
  const today = () => onPickerChange(todayString());

  const isToday = date === todayString();
  const isAtLaunch = date <= LAUNCH_DATE;
  const displayDate = dayjs(date).format('ddd, MMM D, YYYY');

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={prev}
        disabled={isAtLaunch}
        title={isAtLaunch ? 'Launch date — cannot go further back' : 'Previous day (does not add browser history)'}
        className="px-3 py-1.5 rounded-lg text-sm font-medium transition-colors"
        style={{ background: 'var(--bg-primary)', color: isAtLaunch ? 'var(--text-secondary)' : 'var(--text-primary)', border: '1px solid var(--border)', opacity: isAtLaunch ? 0.4 : 1, cursor: isAtLaunch ? 'not-allowed' : 'pointer' }}
      >
        &#8592;
      </button>

      <div className="flex items-center gap-2">
        <span className="text-sm font-medium px-3" style={{ color: 'var(--text-primary)' }}>
          {displayDate}
        </span>
        <input
          type="date"
          value={date}
          min={LAUNCH_DATE}
          onChange={(e) => { if (e.target.value >= LAUNCH_DATE) onPickerChange(e.target.value); }}
          className="px-2 py-1.5 rounded-lg text-sm"
          style={{ background: 'var(--bg-primary)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
        />
      </div>

      <button
        onClick={next}
        title="Next day (does not add browser history)"
        className="px-3 py-1.5 rounded-lg text-sm font-medium transition-colors"
        style={{ background: 'var(--bg-primary)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
      >
        &#8594;
      </button>

      {!isToday && (
        <button
          onClick={today}
          className="px-3 py-1.5 rounded-lg text-sm font-medium"
          style={{ background: 'var(--accent-blue)', color: 'white' }}
        >
          Today
        </button>
      )}
    </div>
  );
}
