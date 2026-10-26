import { useCallback, useEffect, useRef, useState } from 'react';
import {
  BrowserRouter,
  Link,
  NavLink,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from 'react-router-dom';
import {
  ArrowUpRight,
  Bell,
  BookOpen,
  Building2,
  Check,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  FileText,
  Home,
  LayoutGrid,
  LogOut,
  Menu,
  Moon,
  Newspaper,
  Plug,
  Search,
  Settings2,
  SlidersHorizontal,
  Sun,
  ShieldCheck,
  Cpu,
  X,
} from './icons';
import type { AuthResponse, Dashboard as DashboardData, SearchResult } from '../shared/types';
import { api, useApi } from './api';
import { brand } from './brand';
import { AuthContext, useAuth } from './context';
import { ErrorState, Loading, Modal } from './ui';
import { Dashboard } from './pages/Dashboard';
import {
  Applications,
  ApplicationPage,
  NewApplication,
  Products,
  clearApplicationDrafts,
} from './pages/Applications';
import { Simulator } from './pages/Simulator';
import { Documents, Feed, Integrations, Legal, Settings } from './pages/Account';
import { Bank } from './pages/Bank';
import { Login, ProductIntro } from './pages/Entry';
import { usePreferences } from './preferences';
import { useSurfaceMotion } from './useSurfaceMotion';
import { BrandMark } from './BrandMark';
import Admin from './pages/Admin';
import { LocalAssistant } from './pages/LocalAssistant';
import { BusinessProfile, clearBusinessDrafts } from './pages/BusinessProfile';

function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <Link to="/" className="brand">
      <span className="brand-mark" aria-hidden="true">
        <BrandMark />
      </span>
      {!compact && (
        <span>
          {brand.name}
          <small>Кредитный кабинет</small>
        </span>
      )}
    </Link>
  );
}

function SearchDialog({ close }: { close: () => void }) {
  const { auth } = useAuth();
  const input = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  useEffect(() => {
    let active = true;
    if (query.trim().length < 2) {
      setResults([]);
      setBusy(false);
      return;
    }
    setBusy(true);
    const t = setTimeout(() => {
      api<{ results: SearchResult[] }>(`/search?q=${encodeURIComponent(query)}`)
        .then((r) => {
          if (active) {
            setResults(r.results);
            setError('');
          }
        })
        .catch((e) => {
          if (active) setError(e.message);
        })
        .finally(() => {
          if (active) setBusy(false);
        });
    }, 250);
    return () => {
      active = false;
      clearTimeout(t);
    };
  }, [query]);
  return (
    <Modal
      title="Поиск по кабинету"
      close={close}
      initialFocusRef={window.matchMedia('(min-width: 801px)').matches ? input : undefined}
    >
      <div className="search-input">
        <Search size={20} />
        <input
          ref={input}
          placeholder="Заявка, документ, кредит…"
          aria-label="Поисковый запрос"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      {busy ? (
        <Loading />
      ) : error ? (
        <p className="field-error">{error}</p>
      ) : query.length >= 2 ? (
        <div className="search-results">
          {results.length ? (
            results.map((r) => (
              <button
                key={r.id}
                onClick={() => {
                  navigate(r.href);
                  close();
                }}
              >
                <FileText size={19} />
                <span>
                  <b>{r.title}</b>
                  <small>{r.description}</small>
                </span>
                <ChevronRight size={17} />
              </button>
            ))
          ) : (
            <p className="muted">Ничего не найдено. Попробуйте другое слово.</p>
          )}
        </div>
      ) : (
        <div className="quick-links">
          <p className="muted">Быстрый переход</p>
          {(auth.user.role === 'bank'
            ? [
                ['/bank', 'Очередь заявок'],
                ['/products', 'Кредитные продукты'],
                ['/feed', 'События рассмотрения'],
                ['/settings', 'Настроить кабинет'],
              ]
            : [
                ['/products', 'Подобрать кредит'],
                ['/simulator', 'Репетиция заявки'],
                ['/documents', 'Мои документы'],
                ['/settings', 'Настроить кабинет'],
              ]
          ).map(([href, title]) => (
            <button
              key={href}
              onClick={() => {
                navigate(href);
                close();
              }}
            >
              {title}
              <ArrowUpRight size={16} />
            </button>
          ))}
        </div>
      )}
    </Modal>
  );
}

function Notifications({ close }: { close: () => void }) {
  const { data, loading, error } = useApi<DashboardData>('/dashboard');
  return (
    <Modal title="Важное по заявкам" close={close}>
      {loading ? (
        <Loading />
      ) : error ? (
        <p className="field-error">{error}</p>
      ) : data?.actions.length ? (
        data.actions.map((a, i) => (
          <Link key={i} to={a.href} onClick={close} className="notification-item">
            <Bell size={18} />
            <span>
              <b>{a.title}</b>
              <small>{a.description}</small>
            </span>
            <ChevronRight size={18} />
          </Link>
        ))
      ) : (
        <div className="empty">
          <Check size={28} />
          <h3>Всё актуально</h3>
          <p>Когда потребуется ваше действие, оно появится здесь.</p>
        </div>
      )}
    </Modal>
  );
}

function Shell() {
  const {
    auth,
    logout,
    preferences,
    updatePreferences,
    persistenceStatus,
    preferencesError,
    retryPreferences,
  } = useAuth();
  const navigate = useNavigate();
  const [mobile, setMobile] = useState(false);
  const [search, setSearch] = useState(false);
  const [notifications, setNotifications] = useState(false);
  const location = useLocation();
  useSurfaceMotion(location.pathname, preferences.reducedMotion);
  const isBank = auth.user.role === 'bank';
  const isAdmin = auth.user.role === 'admin';
  const isClient = auth.user.role === 'client';
  const home = isAdmin ? '/admin' : isBank ? '/bank' : '/';
  const isIntro = location.pathname === '/welcome';
  const main = useRef<HTMLElement>(null);
  const [narrow, setNarrow] = useState(() => window.matchMedia('(max-width: 800px)').matches);
  useEffect(() => {
    const query = window.matchMedia('(max-width: 800px)');
    const update = () => setNarrow(query.matches);
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  useEffect(() => {
    setMobile(false);
    main.current?.scrollTo(0, 0);
    window.scrollTo(0, 0);
  }, [location.pathname]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (!isAdmin && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearch((s) => !s);
      }
      if (e.key === 'Escape') setMobile(false);
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);
  if (isIntro)
    return (
      <main id="main-content">
        <ProductIntro onOpenCabinet={() => navigate(home)} />
      </main>
    );
  const nav = isAdmin
    ? [{ to: '/admin', label: 'Платформа', icon: ShieldCheck }]
    : isBank
      ? [
          { to: '/bank', label: 'Очередь заявок', icon: LayoutGrid },
          { to: '/products', label: 'Кредитные продукты', icon: LayersIcon },
          { to: '/feed', label: 'События', icon: Newspaper },
        ]
      : [
          { to: '/', label: 'Обзор', icon: Home },
          { to: '/applications', label: 'Мои заявки', icon: FileText },
          { to: '/products', label: 'Подобрать кредит', icon: LayoutGrid },
          { to: '/business', label: 'Профиль бизнеса', icon: Building2 },
          { to: '/simulator', label: 'Репетиция заявки', icon: SlidersHorizontal },
        ];
  return (
    <div className={`app-shell ${mobile ? 'nav-open' : ''}`}>
      <a href="#main-content" className="skip-link">
        Перейти к содержимому
      </a>
      {mobile && (
        <button
          className="nav-backdrop"
          aria-label="Закрыть меню"
          onClick={() => setMobile(false)}
        />
      )}
      <aside
        className="sidebar"
        inert={narrow && !mobile}
        aria-hidden={narrow && !mobile ? true : undefined}
      >
        <div className="sidebar-brand">
          <Brand />
          <button
            className="icon-button mobile-close"
            aria-label="Закрыть меню"
            onClick={() => setMobile(false)}
          >
            <X size={19} />
          </button>
        </div>
        <div className="organization-switch">
          <span className="organization-symbol">
            <Building2 size={21} />
          </span>
          <div>
            <b>
              {auth.organization?.name || (isAdmin ? 'Управление платформой' : 'Кредитный отдел')}
            </b>
            <span>
              {isAdmin ? 'Администратор' : isBank ? 'Рабочее место банка' : 'Бизнес-кабинет'}
            </span>
          </div>
        </div>
        <nav aria-label="Основная навигация">
          {nav.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.to === '/'}
              className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
            >
              <n.icon size={20} />
              <span>{n.label}</span>
              {n.to === '/simulator' && <i className="new-dot" />}
            </NavLink>
          ))}
          <div className="nav-divider" />
          {isClient && (
            <NavLink to="/documents" className="nav-item">
              <FileText size={20} />
              Документы
            </NavLink>
          )}
          {isClient && (
            <NavLink to="/feed" className="nav-item">
              <Newspaper size={20} />
              Для вашего бизнеса
            </NavLink>
          )}
          {!isAdmin && (
            <NavLink to="/assistant" className="nav-item">
              <Cpu size={20} />
              Локальный помощник
            </NavLink>
          )}
          {!isAdmin && (
            <NavLink to="/integrations" className="nav-item">
              <Plug size={20} />
              Интеграции
            </NavLink>
          )}
          <NavLink to="/settings" className="nav-item">
            <Settings2 size={20} />
            Настройки
          </NavLink>
          <NavLink to="/welcome" className="nav-item intro-nav-link">
            <BookOpen size={20} />
            Знакомство с кабинетом
          </NavLink>
        </nav>
        <div className="sidebar-bottom">
          <NavLink to="/legal" className="nav-item help-link">
            <CircleHelp size={19} />О сервисе и документах
          </NavLink>
          <div className="sidebar-user">
            <span className="avatar">
              {auth.user.name
                .split(' ')
                .map((s) => s[0])
                .slice(0, 2)
                .join('')}
            </span>
            <div>
              <b>{auth.user.name}</b>
              <span>
                {isAdmin
                  ? 'Администратор платформы'
                  : isBank
                    ? 'Кредитный аналитик'
                    : 'Представитель компании'}
              </span>
            </div>
            <button
              className="icon-button"
              title="Выйти"
              aria-label="Выйти из кабинета"
              onClick={() => void logout()}
            >
              <LogOut size={17} />
            </button>
          </div>
        </div>
      </aside>
      <div className="main-shell" inert={narrow && mobile}>
        <header className="topbar">
          <button
            className="icon-button menu-button"
            aria-expanded={mobile}
            aria-label="Открыть меню"
            onClick={() => setMobile(true)}
          >
            <Menu size={22} />
          </button>
          {!isAdmin ? (
            <button className="search-trigger" onClick={() => setSearch(true)}>
              <Search size={18} />
              <span>Найти в кабинете</span>
              <kbd>Ctrl K</kbd>
            </button>
          ) : (
            <span className="topbar-role-label">
              <ShieldCheck size={19} /> Управление платформой
            </span>
          )}
          <div className="topbar-actions">
            <button
              className="icon-button theme-toggle"
              aria-label={
                preferences.theme === 'dark' ? 'Включить светлую тему' : 'Включить тёмную тему'
              }
              aria-pressed={preferences.theme === 'dark'}
              onClick={() =>
                updatePreferences({ theme: preferences.theme === 'dark' ? 'light' : 'dark' })
              }
            >
              {preferences.theme === 'dark' ? <Sun size={20} /> : <Moon size={20} />}
            </button>
            {!isAdmin && (
              <button
                className="icon-button notification-button"
                title="Важное по заявкам"
                aria-label="Важное по заявкам"
                onClick={() => setNotifications(true)}
              >
                <Bell size={20} />
              </button>
            )}
            <Link to="/settings" className="topbar-profile" aria-label="Мой профиль">
              <span className="avatar small">{auth.user.name[0]}</span>
              <ChevronDown size={14} />
            </Link>
          </div>
        </header>
        {persistenceStatus === 'error' && (
          <div className="preferences-global-error" role="alert">
            <span>{preferencesError}</span>
            <button className="text-button" onClick={retryPreferences}>
              Повторить сохранение
            </button>
          </div>
        )}
        <main
          id="main-content"
          ref={main}
          className={`workspace ${isIntro ? 'workspace-intro' : ''}`}
        >
          <Routes>
            <Route
              path="/welcome"
              element={<ProductIntro onOpenCabinet={() => navigate(home)} />}
            />
            <Route path="/" element={isClient ? <Dashboard /> : <Navigate to={home} replace />} />
            <Route
              path="/applications"
              element={isClient ? <Applications /> : <Navigate to={home} replace />}
            />
            <Route
              path="/applications/new"
              element={
                isClient ? <NewApplication key={location.key} /> : <Navigate to={home} replace />
              }
            />
            <Route
              path="/applications/:id"
              element={isAdmin ? <Navigate to={home} replace /> : <ApplicationPage />}
            />
            <Route
              path="/products"
              element={isAdmin ? <Navigate to={home} replace /> : <Products />}
            />
            <Route
              path="/simulator"
              element={isClient ? <Simulator /> : <Navigate to={home} replace />}
            />
            <Route
              path="/documents"
              element={isClient ? <Documents /> : <Navigate to={home} replace />}
            />
            <Route
              path="/business"
              element={isClient ? <BusinessProfile /> : <Navigate to={home} replace />}
            />
            <Route path="/feed" element={isAdmin ? <Navigate to={home} replace /> : <Feed />} />
            <Route
              path="/integrations"
              element={isAdmin ? <Navigate to={home} replace /> : <Integrations />}
            />
            <Route
              path="/assistant"
              element={isAdmin ? <Navigate to={home} replace /> : <LocalAssistant />}
            />
            <Route path="/admin" element={isAdmin ? <Admin /> : <Navigate to={home} replace />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/legal" element={<Legal />} />
            <Route path="/bank" element={isBank ? <Bank /> : <Navigate to="/" replace />} />
            <Route
              path="*"
              element={
                <div className="empty">
                  <h1>Такой страницы нет</h1>
                  <p>Проверьте адрес или вернитесь к обзору.</p>
                  <Link to="/" className="button primary">
                    В кабинет
                  </Link>
                </div>
              }
            />
          </Routes>
          <footer className="workspace-footer">
            <span>
              {brand.name}
              <span className="footer-separator">/</span>Кредитный кабинет
            </span>
            <Link to="/legal">Документы и условия</Link>
          </footer>
        </main>
      </div>
      {search && <SearchDialog close={() => setSearch(false)} />}
      {notifications && <Notifications close={() => setNotifications(false)} />}
    </div>
  );
}
const LayersIcon = BookOpen;

export default function App() {
  const [auth, setAuth] = useState<AuthResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const {
    preferences,
    preferencesReady,
    updatePreferences,
    persistenceStatus,
    preferencesError,
    retryPreferences,
    flushPreferences,
  } = usePreferences(auth?.user.id);
  const [message, setMessage] = useState('');
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshAuth = useCallback(async () => {
    setAuth(await api<AuthResponse>('/auth/me'));
  }, []);
  const toast = useCallback((text: string) => {
    setMessage(text);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setMessage(''), 4500);
  }, []);
  useEffect(() => {
    void refreshAuth()
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [refreshAuth]);
  useEffect(() => {
    document.documentElement.dataset.theme = preferences.theme;
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', preferences.theme === 'dark' ? '#1D1C1F' : '#F7F5F2');
    document.documentElement.dataset.density = preferences.density;
    document.documentElement.dataset.accent = preferences.accent;
    document.documentElement.dataset.motion = preferences.reducedMotion ? 'reduced' : 'normal';
  }, [preferences]);
  async function logout() {
    if (!(await flushPreferences())) {
      toast('Не удалось сохранить настройки. Повторите сохранение перед выходом.');
      return;
    }
    try {
      await api('/auth/logout', { method: 'POST' });
      clearBusinessDrafts();
      clearApplicationDrafts();
      setAuth(null);
    } catch (error) {
      toast((error as Error).message);
    }
  }
  if (loading) return <Loading />;
  if (auth && !preferencesReady)
    return preferencesError ? (
      <ErrorState message={preferencesError} retry={retryPreferences} />
    ) : (
      <Loading />
    );
  return (
    <BrowserRouter>
      {auth ? (
        <AuthContext.Provider
          value={{
            auth,
            refreshAuth,
            logout,
            preferences,
            updatePreferences,
            persistenceStatus,
            preferencesError,
            retryPreferences,
            toast,
          }}
        >
          <Shell />
          {message && (
            <div className="toast" role="status">
              <Check size={18} />
              {message}
              <button
                className="icon-button"
                onClick={() => setMessage('')}
                aria-label="Скрыть уведомление"
              >
                <X size={16} />
              </button>
            </div>
          )}
        </AuthContext.Provider>
      ) : (
        <Login onLogin={setAuth} />
      )}
    </BrowserRouter>
  );
}
