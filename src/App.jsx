import { Toaster } from "@/components/ui/toaster"
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import { BrowserRouter as Router, Route, Routes, Navigate } from 'react-router-dom';
import PageNotFound from './lib/PageNotFound';
import { AuthProvider, useAuth } from '@/lib/AuthContext';
import UserNotRegisteredError from '@/components/UserNotRegisteredError';
import ScrollToTop from './components/ScrollToTop';
import Layout from '@/components/Layout';
import { lazy, Suspense } from 'react';
const Dashboard = lazy(() => import('@/pages/Dashboard'));
const Recepcion = lazy(() => import('@/pages/Recepcion'));
const Vuelco = lazy(() => import('@/pages/Vuelco'));
const Produccion = lazy(() => import('@/pages/Produccion'));
const Prefrio = lazy(() => import('@/pages/Prefrio'));
const Camaras = lazy(() => import('@/pages/Camaras'));
const Despachos = lazy(() => import('@/pages/Despachos'));
const Trazabilidad = lazy(() => import('@/pages/Trazabilidad'));
const Catalogos = lazy(() => import('@/pages/Catalogos'));
const Usuarios = lazy(() => import('@/pages/Usuarios'));
import RouteGuard from '@/components/RouteGuard';
import Login from '@/pages/Login';
import ForgotPassword from '@/pages/ForgotPassword';
import ResetPassword from '@/pages/ResetPassword';
import ProtectedRoute from '@/components/ProtectedRoute';
// Add page imports here

const AuthenticatedApp = () => {
  const { isLoadingAuth, isLoadingPublicSettings, authError } = useAuth();

  // Show loading spinner while checking app public settings or auth
  if (isLoadingPublicSettings || isLoadingAuth) {
    return (
      <div className="fixed inset-0 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin"></div>
      </div>
    );
  }

  // Handle authentication errors
  if (authError && authError.type === 'user_not_registered') {
    return <UserNotRegisteredError />;
  }

  // Auth pages (public) + app routes (require session)
  return (
    <Suspense fallback={<div className="fixed inset-0 flex items-center justify-center"><div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin" /></div>}>
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Navigate to="/login" replace />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route element={<ProtectedRoute unauthenticatedElement={<Navigate to="/login" replace />} />}>
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
      </Route>
      <Route path="*" element={<PageNotFound />} />
    </Routes>
    </Suspense>
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
