import { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { Users, CalendarDays, Settings } from 'lucide-react';

interface Props {
  children: React.ReactNode;
}

const navItems = [
  { to: '/', label: 'Kontakte', icon: Users },
  { to: '/woche', label: 'Diese Woche', icon: CalendarDays },
  { to: '/einstellungen', label: 'Einstellungen', icon: Settings },
];

export default function Layout({ children }: Props) {
  const [pressedTab, setPressedTab] = useState<string | null>(null);

  function handleTabPress(to: string) {
    setPressedTab(to);
    setTimeout(() => setPressedTab(null), 230);
  }

  return (
    <div className="flex flex-col min-h-svh bg-background">
      <main className="flex-1 overflow-y-auto pb-20">
        {children}
      </main>

      {/* Bottom navigation */}
      <nav className="fixed bottom-0 left-0 right-0 border-t bg-background/95 backdrop-blur-sm z-50">
        <div className="flex">
          {navItems.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              onClick={() => handleTabPress(to)}
              className={({ isActive }) =>
                `flex flex-col items-center justify-center flex-1 py-2 gap-0.5 text-xs transition-colors ${
                  isActive ? 'text-primary' : 'text-muted-foreground'
                }`
              }
            >
              <span
                className="flex flex-col items-center gap-0.5"
                style={pressedTab === to ? { animation: 'nav-tap 0.23s ease-out forwards' } : undefined}
              >
                <Icon className="h-5 w-5" />
                <span>{label}</span>
              </span>
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  );
}
