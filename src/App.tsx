import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Layout from '@/components/Layout';
import ContactsPage from '@/pages/ContactsPage';
import WeeklyViewPage from '@/pages/WeeklyViewPage';
import SettingsPage from '@/pages/SettingsPage';

export default function App() {
  return (
    <BrowserRouter>
      <Layout>
        <Routes>
          <Route path="/" element={<ContactsPage />} />
          <Route path="/woche" element={<WeeklyViewPage />} />
          <Route path="/einstellungen" element={<SettingsPage />} />
        </Routes>
      </Layout>
    </BrowserRouter>
  );
}
