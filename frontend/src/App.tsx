import type { ReactNode } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import Layout from "./components/Layout";
import { FullPageLoader } from "./components/States";
import Activity from "./pages/Activity";
import AIChat from "./pages/AIChat";
import ConversationDetail from "./pages/ConversationDetail";
import Conversations from "./pages/Conversations";
import Daily from "./pages/Daily";
import InsightsPage from "./pages/Insights";
import KnowledgeGraphPage from "./pages/KnowledgeGraph";
import Learning from "./pages/Learning";
import LearningDetailPage from "./pages/LearningDetail";
import Login from "./pages/Login";
import MeetingDetail from "./pages/MeetingDetail";
import Meetings from "./pages/Meetings";
import Memory from "./pages/Memory";
import NotFound from "./pages/NotFound";
import Overview from "./pages/Overview";
import Search from "./pages/Search";
import Settings from "./pages/Settings";
import Tasks from "./pages/Tasks";
import VoiceAssistant from "./pages/VoiceAssistant";
import { useAuth } from "./store";

function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) return <FullPageLoader label="Checking your session…" />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <>{children}</>;
}

export default function App() {
  const { user, loading } = useAuth();

  return (
    <Routes>
      <Route
        path="/login"
        element={loading ? <FullPageLoader /> : user ? <Navigate to="/" replace /> : <Login />}
      />
      <Route
        path="/"
        element={
          <RequireAuth>
            <Layout />
          </RequireAuth>
        }
      >
        <Route index element={<Overview />} />
        <Route path="chat" element={<AIChat />} />
        <Route path="voice" element={<VoiceAssistant />} />
        <Route path="conversations" element={<Conversations />} />
        <Route path="conversations/:beeId" element={<ConversationDetail />} />
        <Route path="daily" element={<Daily />} />
        <Route path="memory" element={<Memory />} />
        <Route path="tasks" element={<Tasks />} />
        <Route path="meetings" element={<Meetings />} />
        <Route path="meetings/:meetingId" element={<MeetingDetail />} />
        <Route path="learning" element={<Learning />} />
        <Route path="learning/:setId" element={<LearningDetailPage />} />
        <Route path="insights" element={<InsightsPage />} />
        <Route path="graph" element={<KnowledgeGraphPage />} />
        <Route path="search" element={<Search />} />
        <Route path="activity" element={<Activity />} />
        <Route path="settings" element={<Settings />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
