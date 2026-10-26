import { useEffect, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowRight,
  Check,
  ChevronDown,
  Landmark,
  Pause,
  Play,
  ShieldCheck,
} from '../icons';
import type { AuthResponse, DemoAccount } from '../../shared/types';
import { api, money, useApi } from '../api';
import { brand } from '../brand';
import { CapitalScene } from '../CapitalScene';
import { BrandMark } from '../BrandMark';
import { useSurfacePointer } from '../useSurfacePointer';
import { ErrorState, Loading } from '../ui';
import '../entry-v4.css';

const scenarios: Record<
  string,
  {
    initials: string;
    industry: string;
    task: string;
    amount: number;
    term: number;
    focus: string;
    detail: string;
    fact: string;
    documents: [string, boolean][];
  }
> = {
  user_sever: {
    initials: 'См',
    industry: 'Производство мебели',
    task: 'Материалы для нового заказа',
    amount: 1200000,
    term: 24,
    focus: 'От заявки до условной выдачи',
    detail:
      'Устойчивый бизнес готовится к новому заказу. Сравните посильный запрос с большим: параметры заявки меняют решение банка.',
    fact: 'Полный комплект исходных документов',
    documents: [
      ['Выписка по счёту', true],
      ['Финансовая отчётность', true],
    ],
  },
  user_terra: {
    initials: 'Тк',
    industry: 'Кофейни и пекарни',
    task: 'Оборотные средства для кофеен',
    amount: 900000,
    term: 24,
    focus: 'Дополнить заявку и продолжить',
    detail:
      'Для рассмотрения не хватает финансовой отчётности. Добавьте документ и вернитесь к той же заявке — её история сохранится.',
    fact: 'Финансовую отчётность нужно добавить',
    documents: [
      ['Выписка по счёту', true],
      ['Финансовая отчётность', false],
    ],
  },
  user_vector: {
    initials: 'Вл',
    industry: 'Грузоперевозки',
    task: 'Финансирование текущих расходов',
    amount: 1500000,
    term: 24,
    focus: 'Разобраться в причине отказа',
    detail:
      'В исходной кредитной истории есть просрочка 75 дней. Посмотрите, как она влияет на решение и его объяснение.',
    fact: 'В исходных данных есть просрочка 75 дней',
    documents: [
      ['Выписка по счёту', true],
      ['Финансовая отчётность', true],
    ],
  },
};

const chapters = [
  {
    title: 'Сначала — задача.',
    text: 'Новый заказ, оборудование или оборотные средства. Укажите цель, сумму и срок. Сравните платёж с возможностями бизнеса до отправки заявки.',
    note: 'Задача → параметры → расчёт',
    label: 'Задача бизнеса',
  },
  {
    title: 'Потом — факты.',
    text: 'Выручка, расходы, обязательства и документы собираются в одно досье. Если сведений не хватает, запрос банка остаётся в истории рядом с заявкой.',
    note: 'Данные → документы → проверка',
    label: 'Финансовое досье',
  },
  {
    title: 'Дальше — решение.',
    text: 'Одобрение, другие условия, запрос сведений или отказ. У каждого исхода есть причина и следующий шаг. Условия можно изучить до согласия.',
    note: 'Причины → условия → ваше действие',
    label: 'Решение и следующий шаг',
  },
];

function useMotionPreference() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () =>
      setReduced(media.matches || document.documentElement.dataset.motion === 'reduced');
    update();
    media.addEventListener('change', update);
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-motion'],
    });
    return () => {
      media.removeEventListener('change', update);
      observer.disconnect();
    };
  }, []);
  return reduced;
}

function Intro({
  onLogin,
  onOpenCabinet,
}: {
  onLogin?: (auth: AuthResponse) => void;
  onOpenCabinet?: () => void;
}) {
  const { data, error, loading, refresh } = useApi<{ accounts: DemoAccount[] }>(
    '/auth/demo-accounts',
  );
  const [selectedId, setSelectedId] = useState('user_sever');
  const [role, setRole] = useState<'client' | 'bank' | 'admin'>('client');
  const bank = role === 'bank';
  const admin = role === 'admin';
  const [manual, setManual] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState('');
  const [paused, setPaused] = useState(false);
  const [phase, setPhase] = useState(0);
  const chapterRefs = useRef<(HTMLElement | null)[]>([]);
  const storyScene = useRef<HTMLDivElement>(null);
  const reduced = useMotionPreference();
  const accounts = data?.accounts.filter((account) => account.role === 'client') || [];
  const selected =
    role !== 'client'
      ? data?.accounts.find((account) => account.role === role)
      : accounts.find((account) => account.id === selectedId) || accounts[0];
  const scenario = selected && scenarios[selected.id];
  const motion = !paused && !reduced;
  const hero = useSurfacePointer<HTMLElement>(motion, 8);
  const Container = onOpenCabinet ? 'div' : 'main';

  useEffect(() => {
    if (!motion) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      const scene = storyScene.current?.getBoundingClientRect();
      if (!scene || scene.bottom <= 0 || scene.top >= innerHeight) return;
      if (matchMedia('(max-width: 800px)').matches) {
        const progress = (innerHeight * 0.65 - scene.top) / (innerHeight * 0.8);
        setPhase(Math.max(0, Math.min(2, Math.floor(progress * 3))));
      } else {
        let next = 0;
        chapterRefs.current.forEach((chapter, index) => {
          if (chapter && chapter.getBoundingClientRect().top <= innerHeight * 0.65) next = index;
        });
        setPhase(next);
      }
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    schedule();
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
    };
  }, [motion]);

  async function login(email: string, password: string) {
    if (!onLogin) return;
    setBusy(true);
    setFailure('');
    try {
      onLogin(
        await api<AuthResponse>('/auth/login', {
          method: 'POST',
          body: JSON.stringify({ email, password }),
        }),
      );
    } catch (error) {
      setFailure((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Container className="intro-v3 intro-v4" data-motion={motion ? 'on' : 'off'}>
      <a className="v3-skip" href="#v3-demo">
        Перейти к выбору бизнеса
      </a>
      <header className="v3-header">
        <a className="v3-brand" href="#v3-top" aria-label={`${brand.name}, начало страницы`}>
          <span className="v3-brand-mark" aria-hidden="true">
            <BrandMark />
          </span>
          <b>{brand.name}</b>
        </a>
        <nav className="v3-nav" aria-label="О продукте">
          <a href="#v3-process">Кредитный путь</a>
          <a href="#v3-demo">Компании</a>
        </nav>
        {onOpenCabinet ? (
          <button className="v3-header-enter" onClick={onOpenCabinet}>
            В кабинет <ArrowRight size={17} />
          </button>
        ) : (
          <a className="v3-header-enter" href="#v3-demo">
            Войти <ArrowRight size={17} />
          </a>
        )}
      </header>

      <section ref={hero} className="v3-hero" id="v3-top" aria-labelledby="v3-title">
        <div className="v3-hero-copy">
          <p className="v3-product-line">
            <span /> Кредитный кабинет предпринимателя
          </p>
          <h1 id="v3-title">
            Кредитный
            <br />
            путь вашего
            <br />
            бизнеса.
          </h1>
          <p className="v3-hero-description">
            Заявка, документы и решение — одно пространство. Вы видите данные, условия и свой
            следующий шаг.
          </p>
          <div className="v3-hero-actions">
            {onOpenCabinet ? (
              <button className="v3-primary" onClick={onOpenCabinet}>
                Вернуться в кабинет <ArrowRight size={19} />
              </button>
            ) : (
              <a className="v3-primary" href="#v3-demo">
                Выбрать бизнес <ArrowRight size={19} />
              </a>
            )}
            <a className="v3-text-link" href="#v3-process">
              Посмотреть путь <ArrowDown size={17} />
            </a>
          </div>
        </div>
        <figure className="v3-hero-figure">
          <CapitalScene motion={motion} />
          <figcaption className="v3-visually-hidden">
            Пример кредитного процесса: заявка на материалы, данные бизнеса и четыре возможных
            исхода.
          </figcaption>
        </figure>
        <button
          className="v3-motion-toggle"
          onClick={() => setPaused(!paused)}
          disabled={reduced}
          aria-pressed={paused || reduced}
          aria-label={
            reduced
              ? 'Анимация отключена настройками'
              : paused
                ? 'Включить анимацию'
                : 'Приостановить анимацию'
          }
        >
          {paused || reduced ? <Play size={14} /> : <Pause size={14} />}
          <span>
            {reduced ? 'Без анимации' : paused ? 'Продолжить анимацию' : 'Пауза анимации'}
          </span>
        </button>
      </section>

      <section className="v3-story" id="v3-process" aria-labelledby="v3-story-title">
        <div className="v3-story-heading">
          <p>От намерения к действию</p>
          <h2 id="v3-story-title">
            Не теряйте
            <br />
            нить решения.
          </h2>
          <p>Три этапа, одна история. От первых параметров — к условиям и следующему действию.</p>
        </div>
        <div className="v3-story-layout">
          <div className="v3-chapters">
            {chapters.map((chapter, index) => (
              <article
                key={chapter.title}
                ref={(element) => {
                  chapterRefs.current[index] = element;
                }}
                data-chapter={index}
                className={`v3-chapter ${phase === index ? 'is-current' : ''}`}
              >
                <span className="v3-chapter-number">0{index + 1}</span>
                <div>
                  <h3>{chapter.title}</h3>
                  <p>{chapter.text}</p>
                  <span className="v3-chapter-note">{chapter.note}</span>
                </div>
              </article>
            ))}
          </div>
          <div className="v3-story-scene" ref={storyScene}>
            <div className="v3-story-tabs" role="group" aria-label="Показать этап процесса">
              {chapters.map((chapter, index) => (
                <button
                  key={chapter.label}
                  aria-pressed={phase === index}
                  onClick={() => setPhase(index)}
                >
                  <span>0{index + 1}</span>
                  {chapter.label}
                </button>
              ))}
            </div>
            <CapitalScene phase={phase} motion={motion} compact />
            <p className="v3-story-caption">
              {phase === 0
                ? 'Соберите запрос вокруг задачи бизнеса.'
                : phase === 1
                  ? 'Документы дополняют финансовый профиль бизнеса.'
                  : 'В каждом исходе — причина и дальнейшее действие.'}
            </p>
          </div>
        </div>
      </section>

      <section className="v3-demo-section" id="v3-demo" aria-labelledby="v3-demo-title">
        <div className="v3-demo-heading">
          <div>
            <p>Перейдите к своему сценарию</p>
            <h2 id="v3-demo-title">
              Три роли.
              <br />
              Один процесс.
            </h2>
          </div>
          <p>
            Бизнес подаёт заявку. Банк проверяет данные и отвечает. Администратор управляет
            доступностью продуктов и видит историю работы платформы.
          </p>
        </div>
        {loading ? (
          <Loading />
        ) : error ? (
          <ErrorState message={error} retry={refresh} />
        ) : (
          <div className="v3-business-workspace">
            <div className="v3-business-index">
              <div className="v3-index-label">
                Предприниматель <span>{accounts.length} компании</span>
              </div>
              <div className="v3-business-list" aria-label="Выберите компанию">
                {accounts.map((account, index) => (
                  <button
                    className={`entry-business v3-business ${role === 'client' && selected?.id === account.id ? 'is-selected' : ''}`}
                    aria-pressed={role === 'client' && selected?.id === account.id}
                    key={account.id}
                    disabled={busy}
                    onClick={() => {
                      setSelectedId(account.id);
                      setRole('client');
                      setFailure('');
                    }}
                  >
                    <span className="v3-business-initial">
                      {scenarios[account.id]?.initials || index + 1}
                    </span>
                    <span>
                      <b>{account.organization}</b>
                      <small>{scenarios[account.id]?.industry || account.scenario}</small>
                    </span>
                    <ArrowRight size={18} />
                  </button>
                ))}
              </div>
              <button
                className={`v3-bank ${bank ? 'is-selected' : ''}`}
                aria-pressed={bank}
                disabled={busy}
                onClick={() => {
                  setRole('bank');
                  setFailure('');
                }}
              >
                <Landmark size={22} />
                <span>
                  <b>Рабочее место банка</b>
                  <small>Тот же процесс, другая сторона</small>
                </span>
                <ArrowRight size={17} />
              </button>
              <button
                className={`v3-bank v5-admin-entry ${admin ? 'is-selected' : ''}`}
                aria-pressed={admin}
                disabled={busy}
                onClick={() => {
                  setRole('admin');
                  setFailure('');
                }}
              >
                <ShieldCheck size={22} />
                <span>
                  <b>Управление платформой</b>
                  <small>Продукты, пользователи и аудит</small>
                </span>
                <ArrowRight size={17} />
              </button>
              <p className="v3-switch-note">
                Смена роли — через выход.
                <br />
                Сохранённые заявки остаются на месте.
              </p>
            </div>
            <div
              className={`v3-selected-business ${role !== 'client' ? 'is-bank' : ''}`}
              aria-label="Выбранный сценарий"
            >
              <div className="v3-selected-top">
                <span>
                  {admin
                    ? 'Доступность и контроль'
                    : bank
                      ? 'Рассмотрение заявок'
                      : scenario?.industry}
                </span>
                <span className="v3-selected-stamp">
                  {admin ? 'Админ' : bank ? 'Банк' : scenario?.initials}
                </span>
              </div>
              <h3>
                {admin
                  ? 'Платформа под контролем'
                  : bank
                    ? 'Кредитный центр'
                    : selected?.organization}
              </h3>
              <p className="v3-selected-description">
                {admin
                  ? 'Управляйте приёмом новых заявок по продуктам. Проверяйте активность пользователей, выгружайте реестр и журнал событий. Принятие кредитных решений остаётся за банком.'
                  : bank
                    ? 'Рассматривайте обращения компаний, запускайте проверки и изучайте причины. Решение и запрос документов сохраняются в истории заявки.'
                    : scenario?.detail || selected?.scenario}
              </p>
              {role === 'client' && scenario ? (
                <>
                  <div className="v3-request">
                    <div>
                      <span>Задача бизнеса</span>
                      <b>{scenario.task}</b>
                    </div>
                    <div>
                      <strong>{money(scenario.amount)}</strong>
                      <span>на {scenario.term} месяца</span>
                    </div>
                  </div>
                  <div className="v3-materials">
                    {scenario.documents.map(([label, ready]) => (
                      <div key={label}>
                        <span className={ready ? 'is-ready' : 'is-needed'}>
                          {ready ? <Check size={14} /> : '+'}
                        </span>
                        <span>{label}</span>
                        <small>{ready ? 'в исходном комплекте' : 'нужно добавить'}</small>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <div className="v3-bank-process">
                  <span>{admin ? 'Доступность' : 'Заявка'}</span>
                  <i />
                  <span>{admin ? 'Контроль' : 'Проверка'}</span>
                  <i />
                  <span>{admin ? 'Аудит' : 'Решение'}</span>
                  <p>
                    {admin
                      ? 'Приостановка приёма не прерывает рассмотрение уже отправленных заявок.'
                      : 'Параметры, документы и объяснение результата в одном рабочем процессе.'}
                  </p>
                </div>
              )}
              <div className="v3-enter">
                <div>
                  <span>{onOpenCabinet ? 'Вы уже авторизованы' : 'Вы войдёте как'}</span>
                  <b>{onOpenCabinet ? 'Текущий аккаунт сохранится' : selected?.name}</b>
                </div>
                <button
                  className="v3-primary"
                  disabled={busy || !selected}
                  onClick={() =>
                    onOpenCabinet
                      ? onOpenCabinet()
                      : selected && void login(selected.email, selected.password)
                  }
                >
                  {busy
                    ? 'Открываем кабинет…'
                    : onOpenCabinet
                      ? 'Вернуться в кабинет'
                      : role !== 'client'
                        ? 'Открыть рабочее место'
                        : 'Открыть кабинет'}
                  {busy ? <span className="small-spinner" /> : <ArrowRight size={19} />}
                </button>
              </div>
              {failure && (
                <p className="v3-error" role="alert">
                  {failure}
                </p>
              )}
              <p className="v3-current-state-note">
                Здесь показан начальный сценарий. В кабинете — актуальные сохранённые заявки.
              </p>
            </div>
          </div>
        )}
      </section>

      <footer className="v3-footer">
        <div className="v3-footer-top">
          <span className="v3-footer-brand">{brand.name}</span>
          <a className="v3-footer-top-link" href="#v3-top">
            К началу страницы <ArrowRight size={22} />
          </a>
        </div>
        <div className="v3-footer-bottom">
          <span>Кредитный кабинет предпринимателя</span>
          {!onOpenCabinet && (
            <button
              className="v3-manual-toggle"
              aria-expanded={manual}
              aria-controls="v3-manual-login"
              onClick={() => setManual(!manual)}
            >
              Войти по логину и паролю <ChevronDown size={16} />
            </button>
          )}
        </div>
        {manual && !onOpenCabinet && (
          <form
            className="v3-manual"
            id="v3-manual-login"
            onSubmit={(event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              void login(String(form.get('email')), String(form.get('password')));
            }}
          >
            <label>
              Электронная почта
              <input name="email" type="email" required autoComplete="username" />
            </label>
            <label>
              Пароль
              <input name="password" type="password" required autoComplete="current-password" />
            </label>
            <button className="v3-primary" disabled={busy}>
              Войти <ArrowRight size={17} />
            </button>
            {failure && (
              <p className="v3-error" role="alert">
                {failure}
              </p>
            )}
          </form>
        )}
        <details className="v3-rules">
          <summary>Условия использования и данные</summary>
          <p>
            Общедоступные учебные аккаунты сохраняют заявки, документы, настройки и историю. Не
            загружайте настоящие выписки, договоры или персональные сведения. Cookie dk_session
            поддерживает вход в течение 12 часов. Рекламные и аналитические cookies не используются.
            Проверки, подписание и выдача имитируются; реальные деньги не переводятся. Этот прототип
            не является предложением кредита или финансовой услугой.
          </p>
          <a href="/THIRD_PARTY_NOTICES.txt" target="_blank" rel="noreferrer">
            Компоненты, лицензии и источники
          </a>
        </details>
      </footer>
    </Container>
  );
}

export function Login({ onLogin }: { onLogin: (auth: AuthResponse) => void }) {
  return <Intro onLogin={onLogin} />;
}
export function ProductIntro({ onOpenCabinet }: { onOpenCabinet: () => void }) {
  return <Intro onOpenCabinet={onOpenCabinet} />;
}
export default Login;
