import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import "./experience.css";
import { MotionConfig } from "framer-motion";

import { LotteryPage } from "./pages/LotteryPage";

// 管理画面は運営者しか使わないため、お客様画面の初回読み込みから分離する
const AdminLotteryPage = lazy(() =>
  import("./pages/AdminLotteryPage").then((module) => ({
    default: module.AdminLotteryPage,
  })),
);

const App = () => (
  <MotionConfig reducedMotion="user">
    <Routes>
      <Route path="/lottery" element={<LotteryPage />} />
      <Route
        path="/admin"
        element={
          <Suspense fallback={<div className="page-loading" role="status">読み込み中…</div>}>
            <AdminLotteryPage />
          </Suspense>
        }
      />
      <Route path="*" element={<Navigate to="/lottery" replace />} />
    </Routes>
  </MotionConfig>
);

export default App;
