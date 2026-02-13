import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AppProvider, useApp } from './context/AppContext';
import { I18nProvider } from './i18n';
import { Layout } from './components/Layout';
import { Onboarding } from './pages/Onboarding';
import { Dashboard } from './pages/Dashboard';
import { CreateGroup } from './pages/CreateGroup';
import { JoinGroup } from './pages/JoinGroup';
import { GroupDetail } from './pages/GroupDetail';
import { AddExpense } from './pages/AddExpense';
import { Settings } from './pages/Settings';

function AppRoutes() {
  const { isOnboarded } = useApp();

  if (!isOnboarded) {
    return (
      <Routes>
        <Route path="*" element={<Onboarding />} />
      </Routes>
    );
  }

  return (
    <Layout>
      <Routes>
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/create-group" element={<CreateGroup />} />
        <Route path="/join" element={<JoinGroup />} />
        <Route path="/group/:id" element={<GroupDetail />} />
        <Route path="/group/:id/expense" element={<AddExpense />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </Layout>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <I18nProvider>
        <AppProvider>
          <AppRoutes />
        </AppProvider>
      </I18nProvider>
    </BrowserRouter>
  );
}
