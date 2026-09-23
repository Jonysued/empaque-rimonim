import { Toaster } from "@/components/ui/toaster"
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import { BrowserRouter as Router, Route, Routes } from 'react-router-dom';
import PageNotFound from './lib/PageNotFound';
import { AuthProvider, useAuth } from '@/lib/AuthContext';
import UserNotRegisteredError from '@/components/UserNotRegisteredError';
import ScrollToTop from './components/ScrollToTop';
import Layout from '@/components/Layout';
import Dashboard from '@/pages/Dashboard';
import Recepcion from '@/pages/Recepcion';
import Vuelco from '@/pages/Vuelco';
import Produccion from '@/pages/Produccion';
import Prefrio from '@/pages/Prefrio';
import Camaras from '@/pages/Camaras';
import Despachos from '@/pages/Despachos';
import Trazabilidad from '@/pages/Trazabilidad';
import Catalogos from '@/pages/Catalogos';
import Usuarios from '@/pages/Usuarios';
import RouteGuard from '@/components/RouteGuard';
// Add page imports here

const AuthenticatedApp = () => {
  const { isLoadingAuth, isLoadingPublicSettings, authError, navigateToLogin } = useAuth();

  // Show loading spinner while checking app public settings or auth
  if (isLoadingPublicSettings || isLoadingAuth) {
    return (
      <div className="fixed inset-0 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin"></div>
      </div>
    );
  }

  // Handle authentication errors
  if (authError) {
    if (authError.type === 'user_not_registered') {
      return <UserNotRegisteredError />;
    } else if (authError.type === 'auth_required') {
      // Redirect to login automatically
      navigateToLogin();
      return null;
    }
  }

  // Render the main app
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/recepcion" element={<RouteGuard><Recepcion /></RouteGuard>} />
        <Route path="/vuelco" element={<RouteGuard><Vuelco /></RouteGuard>} />
        <Route path="/produccion" element={<RouteGuard><Produccion /></RouteGuard>} />
        <Route path="/prefrio" element={<RouteGuard><Prefrio /></RouteGuard>} />
        <Route path="/camaras" element={<RouteGuard><Camaras /></RouteGuard>} />
        <Route path="/despachos" element={<RouteGuard><Despachos /></RouteGuard>} />
        <Route path="/trazabilidad" element={<Trazabilidad />} />
        <Route path="/catalogos" element={<RouteGuard><Catalogos /></RouteGuard>} />
        <Route path="/usuarios" element={<RouteGuard><Usuarios /></RouteGuard>} />
      </Route>
      <Route path="*" element={<PageNotFound />} />
    </Routes>
  );
};


function App() {

  return (
    <AuthProvider>
      <QueryClientProvider client={queryClientInstance}>
        <Router>
          <ScrollToTop />
          <AuthenticatedApp />
        </Router>
        <Toaster />
      </QueryClientProvider>
    </AuthProvider>
  )
}

export default App