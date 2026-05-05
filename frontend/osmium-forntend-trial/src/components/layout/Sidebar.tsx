import { Home, LayoutDashboard, FolderKanban, ClipboardList, BarChart3, Bell, LifeBuoy, Settings, Search, Menu, MoreVertical, Activity } from 'lucide-react';
import { cn } from '@/src/lib/utils';
import { api } from '@/src/services/api';
import { useState, useEffect } from 'react';

const navItems = [
  { icon: Home, label: 'Home', active: true },
  { icon: LayoutDashboard, label: 'Dashboard' },
  { icon: FolderKanban, label: 'Projects' },
  { icon: ClipboardList, label: 'Tasks' },
  { icon: BarChart3, label: 'Reporting' },
];

const secondaryItems = [
  { icon: Bell, label: 'Notifications', badge: 12 },
  { icon: LifeBuoy, label: 'Support' },
  { icon: Settings, label: 'Settings' },
];

export default function Sidebar() {
  const [isOnline, setIsOnline] = useState<boolean | null>(null);

  useEffect(() => {
    const checkHealth = async () => {
      try {
        await api.getHealth();
        setIsOnline(true);
      } catch {
        setIsOnline(false);
      }
    };
    checkHealth();
    const interval = setInterval(checkHealth, 30000);
    return () => clearInterval(interval);
  }, []);

  return (
    <aside className="w-72 bg-surface-container-lowest border-r border-outline-variant flex flex-col h-full flex-shrink-0">
      <header className="h-20 flex items-center justify-between px-6 flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-accent-purple rounded-lg flex items-center justify-center text-white">
            <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 2L4.5 20.29l.71.71L12 18l6.79 3 .71-.71z" />
            </svg>
          </div>
          <span className="text-xl font-bold tracking-tight text-on-surface">Osmium</span>
        </div>
        <button className="p-2 text-on-surface-variant hover:text-on-surface transition-colors">
          <Menu className="h-6 w-6" />
        </button>
      </header>

      <div className="px-6 mb-8">
        <div className="relative group">
          <Search className="absolute inset-y-0 left-3 my-auto h-4 w-4 text-on-surface-variant group-focus-within:text-accent-purple transition-colors" />
          <input
            type="text"
            placeholder="Search"
            className="block w-full pl-10 pr-3 py-2.5 bg-surface-container border-none rounded-xl text-sm text-on-surface placeholder:text-on-surface-variant focus:ring-1 focus:ring-accent-purple focus:bg-surface-container-high transition-all outline-none"
          />
        </div>
      </div>

      <nav className="flex-1 px-4 space-y-1 overflow-y-auto">
        {navItems.map((item) => (
          <a
            key={item.label}
            href="#"
            className={cn(
              "flex items-center px-3 py-3 text-sm font-medium rounded-xl transition-colors group",
              item.active 
                ? "bg-accent-purple/10 text-accent-purple" 
                : "text-on-surface-variant hover:text-on-surface hover:bg-surface-container"
            )}
          >
            <item.icon className="mr-4 h-5 w-5" />
            {item.label}
          </a>
        ))}
      </nav>

      <div className="px-4 py-6 border-t border-outline-variant space-y-1">
        <div className="px-3 py-2 mb-2 flex items-center justify-between">
          <span className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">Backend Status</span>
          <div className="flex items-center gap-1.5">
            <div className={cn("w-1.5 h-1.5 rounded-full animate-pulse", isOnline === true ? "bg-green-500" : isOnline === false ? "bg-red-500" : "bg-yellow-500")} />
            <span className={cn("text-[10px] font-medium", isOnline === true ? "text-green-500" : isOnline === false ? "text-red-500" : "text-yellow-500")}>
              {isOnline === true ? 'Online' : isOnline === false ? 'Offline' : 'Checking...'}
            </span>
          </div>
        </div>

        {secondaryItems.map((item) => (
          <a
            key={item.label}
            href="#"
            className="flex items-center justify-between px-3 py-3 text-sm font-medium rounded-xl text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-colors group"
          >
            <div className="flex items-center">
              <item.icon className="mr-4 h-5 w-5" />
              {item.label}
            </div>
            {item.badge && (
              <span className="bg-accent-purple text-white text-[10px] px-2 py-0.5 rounded-full font-bold">
                {item.badge}
              </span>
            )}
          </a>
        ))}

        <div className="mt-8 bg-surface-container rounded-2xl p-4 flex items-center gap-3 border border-outline-variant group cursor-pointer hover:border-outline transition-all">
          <div className="relative flex-shrink-0">
            <img
              src="https://lh3.googleusercontent.com/aida-public/AB6AXuD8vqDFdZCzBkdrRpGxZEVgtny9_HGjYWu82C3l1Enwl46LWE_JXOX7SvOVla5mAjkRoY-UmlZdL-ofxlGaqmyM5SlYSPEHJS5mI-r3k_hfGlZEsgDST09vIiX4mvhIXPha107RI3ByalIjLldoY0KCEJwyKmfqJ3-mc84Ye89DO1Xs8E0nGgRiFIiVDop7YrwD7jy1d4nriYe0i3Txvr5ViDAARm5I96KkRcZ9VSGhCcIITA7pgJ2_GWn6sQG2ZHVtc871zPTlMfM"
              alt="Brooklyn Simmons"
              className="w-10 h-10 rounded-full bg-surface-container-highest"
            />
            <span className="absolute bottom-0 right-0 block h-2.5 w-2.5 rounded-full ring-2 ring-surface-container bg-green-500"></span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-on-surface truncate">Brooklyn Simmons</p>
            <p className="text-xs text-on-surface-variant truncate">brooklyn@simmons.com</p>
          </div>
          <button className="text-on-surface-variant hover:text-on-surface transition-colors">
            <MoreVertical className="h-5 w-5" />
          </button>
        </div>
      </div>
    </aside>
  );
}
