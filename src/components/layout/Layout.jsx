import { Outlet } from 'react-router-dom';
import Navbar from './Navbar.jsx';

export default function Layout() {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 antialiased">
      <Navbar />
      <main className="mx-auto max-w-6xl px-4 py-8">
        <Outlet />
      </main>
    </div>
  );
}
