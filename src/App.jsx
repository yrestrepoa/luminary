import { WalletProvider } from './context/WalletContext.jsx';
import Navbar from './components/layout/Navbar.jsx';
import Market from './views/Market.jsx';

export default function App() {
  return (
    <WalletProvider>
      <div className="min-h-screen bg-slate-950 text-slate-100 antialiased">
        <Navbar />
        <Market />
      </div>
    </WalletProvider>
  );
}
