import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import Card from './ui/Card';

export default function ProtectedRoute({ children, roles }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-paper">
        <div className="w-6 h-6 rounded-full border-2 border-ink/10 border-t-seal animate-spin" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  }

  if (roles && !roles.includes(user.role)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-paper px-4">
        <Card className="max-w-sm w-full p-8 text-center">
          <p className="text-sm text-ink/60">
            Your account ({user.role}) doesn't have access to this page.
          </p>
        </Card>
      </div>
    );
  }

  return children;
}
