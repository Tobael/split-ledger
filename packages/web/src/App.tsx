import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AppProvider, useApp } from './context/AppContext';
import { I18nProvider } from './i18n';
import { Layout } from './components/Layout';
import { Footer } from './components/Footer';
import { Onboarding } from './pages/Onboarding';
import { Dashboard } from './pages/Dashboard';
import { CreateGroup } from './pages/CreateGroup';
import { JoinGroup } from './pages/JoinGroup';
import { GroupDetail } from './pages/GroupDetail';
import { AddExpense } from './pages/AddExpense';
import { Settings } from './pages/Settings';
import { GroupRecovery } from './pages/GroupRecovery';
import { Impressum } from './pages/Impressum';
import { PrivacyPolicy } from './pages/PrivacyPolicy';

const PublicLayout = ({ children }: { children: React.ReactNode }) => (
  <div className="app-layout">
    <main className="app-main">{children}</main>
    <Footer />
  </div>
);

function AppRoutes() {
  const { isOnboarded } = useApp();

  if (!isOnboarded) {
    return (
      <Routes>
        <Route path="/impressum" element={<PublicLayout><Impressum /></PublicLayout>} />
        <Route path="/privacy" element={<PublicLayout><PrivacyPolicy /></PublicLayout>} />
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
        <Route path="/group/:id/recovery" element={<GroupRecovery />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/impressum" element={<Impressum />} />
        <Route path="/privacy" element={<PrivacyPolicy />} />
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
