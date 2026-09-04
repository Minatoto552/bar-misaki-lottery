import { Navigate, Route, Routes } from "react-router-dom";
import "./experience.css";
import { MotionConfig } from "framer-motion";

import { AdminLotteryPage } from "./pages/AdminLotteryPage";
import { LotteryPage } from "./pages/LotteryPage";

const App = () => (
  <MotionConfig reducedMotion="user">
    <Routes>
      <Route path="/lottery" element={<LotteryPage />} />
      <Route path="/admin" element={<AdminLotteryPage />} />
      <Route path="*" element={<Navigate to="/lottery" replace />} />
    </Routes>
  </MotionConfig>
);

export default App;
