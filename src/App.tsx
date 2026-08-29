import { Navigate, Route, Routes } from 'react-router-dom';

import { AdminLotteryPage } from './pages/AdminLotteryPage';
import { LotteryPage } from './pages/LotteryPage';

const App = () => (
  <Routes>
    <Route path="/lottery" element={<LotteryPage />} />
    <Route path="/admin" element={<AdminLotteryPage />} />
    <Route path="*" element={<Navigate to="/lottery" replace />} />
  </Routes>
);

export default App;
