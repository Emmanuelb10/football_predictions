import { useMemo } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import PredictionsPage from './pages/PredictionsPage';
import NotFound from './pages/NotFound';
import { todayPath } from './lib/routing';

function RedirectToToday() {
  const path = useMemo(() => todayPath(), []);
  return <Navigate to={path} replace />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<RedirectToToday />} />
      <Route path="/:date" element={<PredictionsPage />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
