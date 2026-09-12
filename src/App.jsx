import React, { useState, useEffect, useCallback, useMemo } from "react";
import {
  Plus, Home, BookOpen, Target, User, X, Check, TrendingUp, TrendingDown,
  Wallet, Bell, BellOff, Calendar, ChevronRight, Trash2, ArrowUpRight,
  ArrowDownRight, Loader2, Sparkles, Flag, Settings2, AlertTriangle,
  LogIn, LogOut, ShieldCheck, Zap, RefreshCw, Layers
} from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell,
} from "recharts";
import {
  toLocalISODate, parseLocalDate, todayISO, daysBetween, addDays, FREQ_DAYS,
  computeNextAllowanceReminderDate, computeSnoozeDate,
} from "./lib/budgetMath.js";

const C = {
  paper: "#EFEBE2",
  paperDark: "#E3DDCE",
  card: "#F8F6F0",
  ink: "#1F2A24",
  inkSoft: "#3A473F",
  moss: "#3F6B52",
  mossLight: "#7FA98D",
  mossBg: "#E1EBE3",
  clay: "#B5623A",
  clayLight: "#D89B7C",
  clayBg: "#F3E1D6",
  brass: "#A98544",
  brassLight: "#D4B876",
  brassBg: "#F1E6CC",
  slate: "#6B7268",
  line: "#D8D2C2",
  danger: "#A63D3D",
  dangerBg: "#F5DEDE",
  white: "#FFFFFF",
  ringGreen: "#8FD9A8",
  ringBlue: "#8FC1EB",
  ringPurple: "#C7A8EE",
};

const SPLIT_PRESETS = [
  { id: "50-30-20", label: "50/30/20 Standard", split: { needs: 50, wants: 30, savings: 20 } },
  { id: "60-20-20", label: "60/20/20 Needs Focus", split: { needs: 60, wants: 20, savings: 20 } },
  { id: "40-30-30", label: "40/30/30 Savings", split: { needs: 40, wants: 30, savings: 30 } },
  { id: "70-20-10", label: "70/20/10 Aggressive", split: { needs: 70, wants: 20, savings: 10 } },
  { id: "50-20-30", label: "50/20/30 Balanced", split: { needs: 50, wants: 20, savings: 30 } },
  { id: "personal", label: "Personal custom", split: null },
];

const FONT_IMPORT =
  "@import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600;9..144,700&family=Public+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap');";

const CURRENCIES = [
  { code: "USD", symbol: "$" }, { code: "EUR", symbol: "€" },
  { code: "GBP", symbol: "£" }, { code: "MYR", symbol: "RM" },
  { code: "SGD", symbol: "S$" }, { code: "JPY", symbol: "¥" },
  { code: "AUD", symbol: "A$" }, { code: "INR", symbol: "₹" },
];
const FREQUENCIES = ["Daily", "Weekly", "Monthly", "Yearly"];
const EXP_FREQS = ["day", "week", "month", "year"];
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const STORAGE_KEY = "ledger_budget_app_data_v2";
// REQUIRED: replace with your own OAuth Web Client ID from https://console.cloud.google.com/apis/credentials
// (Authorized JavaScript origins must include your dev URL, e.g. http://localhost:5173, and your production/Capacitor origin.)
const GOOGLE_CLIENT_ID = "YOUR_GOOGLE_OAUTH_CLIENT_ID.apps.googleusercontent.com";
function decodeGoogleJwt(token) {
  try {
    const payload = token.split(".")[1];
    const json = decodeURIComponent(
      atob(payload.replace(/-/g, "+").replace(/_/g, "/"))
        .split("")
        .map((c) => "%" + c.charCodeAt(0).toString(16).padStart(2, "0"))
        .join("")
    );
    return JSON.parse(json);
  } catch (e) {
    return null;
  }
}

const storageHelper = {
  get: async (key) => {
    try {
      if (typeof window !== "undefined" && window.storage && typeof window.storage.get === "function") {
        return await window.storage.get(key, false);
      }
      const item = localStorage.getItem(key);
      return item ? { value: item } : null;
    } catch (e) {
      console.warn("Storage access warning:", e);
      return null;
    }
  },
  set: async (key, val) => {
    try {
      if (typeof window !== "undefined" && window.storage && typeof window.storage.set === "function") {
        await window.storage.set(key, val, false);
        return;
      }
      localStorage.setItem(key, val);
    } catch (e) {
      console.error("Storage save error:", e);
    }
  }
};

const symbolFor = (code) => (CURRENCIES.find((c) => c.code === code) || {}).symbol || "$";
const fmt = (amount, symbol) =>
  `${symbol}${Number(amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function nextWeekday(fromIso, targetDay) {
  const d = parseLocalDate(fromIso);
  const day = d.getDay();
  let diff = (targetDay - day + 7) % 7;
  if (diff === 0) diff = 7;
  d.setDate(d.getDate() + diff);
  return toLocalISODate(d);
}

function expenseMonthly(amount, freq) {
  const a = Number(amount) || 0;
  const f = (freq || "").toLowerCase();
  if (f === "day" || f === "daily") return a * 30;
  if (f === "week" || f === "weekly") return a * 4.33;
  if (f === "year" || f === "yearly") return a / 12;
  return a;
}

function allowanceMonthly(amount, freq) {
  const a = Number(amount) || 0;
  const f = (freq || "").toLowerCase();
  if (f === "daily" || f === "day") return a * 30;
  if (f === "weekly" || f === "week") return a * 4.33;
  if (f === "yearly" || f === "year") return a / 12;
  return a;
}

function suggestSplit(needsMonthly = 0, allowanceMonthlyVal = 0) {
  if (allowanceMonthlyVal <= 0) return { needs: 50, wants: 30, savings: 20 };
  const committedNeedsPct = Math.ceil((needsMonthly / allowanceMonthlyVal) * 100);
  
  if (committedNeedsPct <= 50) {
    return { needs: 50, wants: 30, savings: 20 };
  }
  
  const needs = Math.min(75, Math.max(50, committedNeedsPct + 5));
  const remaining = 100 - needs;
  const wants = Math.round(remaining * 0.6);
  const savings = 100 - needs - wants;
  return { needs, wants, savings };
}

function computeBalance(profile, logs) {
  const income = logs.reduce((s, l) => s + (l.type === "income" ? l.amount : 0), 0);
  const spent = logs.reduce((s, l) => s + (l.type === "expense" ? l.amount : 0), 0);
  return (Number(profile.totalReceived) || Number(profile.allowance) || 0) + income - spent;
}

function uid() { return Math.random().toString(36).slice(2, 10); }
function relevanceScore(item, balance) {
  const typeScore = item.type === "need" ? 1000 : 0;
  let dateScore = 0;
  if (item.targetDate) {
    const days = daysBetween(todayISO(), item.targetDate);
    dateScore = days <= 0 ? 500 : Math.max(0, 500 - days * 5);
  }
  const affordScore = item.cost <= balance ? 200 : Math.max(0, 200 - (item.cost - balance) / 5);
  return typeScore + dateScore + affordScore;
}
function sortByRelevance(items, balance) {
  return items.slice().sort((a, b) => relevanceScore(b, balance) - relevanceScore(a, balance));
}

function Field({ label, children }) {
  return (
    <label className="block mb-4">
      <span className="block text-xs font-semibold tracking-wide uppercase mb-1.5" style={{ color: C.slate, fontFamily: "'Public Sans', sans-serif" }}>
        {label}
      </span>
      {children}
    </label>
  );
}

const inputCls = "w-full px-3.5 py-2.5 rounded-lg border outline-none text-[15px] transition-colors focus:ring-2";

function TextInput(props) {
  return (
    <input
      {...props}
      className={inputCls}
      style={{
        borderColor: C.line, background: C.card, color: C.ink,
        fontFamily: "'Public Sans', sans-serif", ...(props.style || {}),
      }}
    />
  );
}

function Select({ value, onChange, options, style }) {
  return (
    <select
      value={value}
      onChange={onChange}
      className={inputCls}
      style={{ borderColor: C.line, background: C.card, color: C.ink, fontFamily: "'Public Sans', sans-serif", ...style }}
    >
      {options.map((o) => (
        <option key={o.value ?? o} value={o.value ?? o}>{o.label ?? o}</option>
      ))}
    </select>
  );
}

function PillToggle({ options, value, onChange }) {
  return (
    <div className="inline-flex rounded-full p-1 gap-1" style={{ background: C.paperDark }}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className="px-4 py-1.5 rounded-full text-sm font-semibold transition-colors"
          style={{
            fontFamily: "'Public Sans', sans-serif",
            background: value === o.value ? C.ink : "transparent",
            color: value === o.value ? C.paper : C.slate,
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Btn({ children, onClick, variant = "primary", className = "", type = "button", disabled }) {
  const styles = {
    primary: { background: C.ink, color: C.paper },
    accent: { background: C.moss, color: C.white },
    ghost: { background: "transparent", color: C.ink, border: `1px solid ${C.line}` },
    danger: { background: "transparent", color: C.danger, border: `1px solid ${C.danger}55` },
  };
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`px-4 py-2.5 rounded-lg font-semibold text-sm inline-flex items-center justify-center gap-1.5 transition-transform active:scale-[0.97] disabled:opacity-50 ${className}`}
      style={{ fontFamily: "'Public Sans', sans-serif", ...styles[variant] }}
    >
      {children}
    </button>
  );
}

function Card({ children, className = "", style }) {
  return (
    <div
      className={`rounded-2xl p-4 ${className}`}
      style={{ background: C.card, border: `1px solid ${C.line}`, ...style }}
    >
      {children}
    </div>
  );
}

function Modal({ title, onClose, children, z = 50 }) {
  return (
    <div className="fixed inset-0 flex items-end sm:items-center justify-center" style={{ zIndex: z }}>
      <div className="absolute inset-0" style={{ background: "#1F2A2499" }} onClick={onClose} />
      <div
        className="relative w-full sm:max-w-md rounded-t-3xl sm:rounded-2xl p-5 max-h-[88vh] overflow-y-auto"
        style={{ background: C.paper, border: `1px solid ${C.line}` }}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold" style={{ fontFamily: "'Fraunces', serif", color: C.ink }}>{title}</h3>
          <button onClick={onClose} className="p-1.5 rounded-full" style={{ background: C.paperDark }}>
            <X size={16} color={C.ink} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Banner({ children, onAction, actionLabel }) {
  return (
    <div
      className="flex items-center justify-between gap-3 px-4 py-3 rounded-xl mb-4"
      style={{ background: C.brassBg, border: `1px solid ${C.brass}55` }}
    >
      <div className="flex items-center gap-2 text-sm font-medium" style={{ color: C.ink, fontFamily: "'Public Sans', sans-serif" }}>
        <Bell size={16} color={C.brass} /> {children}
      </div>
      {onAction && (
        <button onClick={onAction} className="text-sm font-bold whitespace-nowrap" style={{ color: C.brass }}>
          {actionLabel} →
        </button>
      )}
    </div>
  );
}

function Rings({ overallSpent, overallTotal, needsSpent, needsTotal, wantsSpent, wantsTotal, symbol }) {
  const r1 = 78, r2 = 60, r3 = 42, sw = 10;
  const pct = (spent, total) => (total ? spent / total : 0);
  const tone = (spent, total, base) => (total > 0 && spent > total ? C.danger : base);
  const arc = (r, p, color) => {
    const circ = 2 * Math.PI * r;
    const dash = Math.max(0, Math.min(1, p)) * circ;
    return (
      <>
        <circle cx="90" cy="90" r={r} fill="none" stroke={C.line} strokeWidth={sw} />
        <circle
          cx="90" cy="90" r={r} fill="none" stroke={color} strokeWidth={sw}
          strokeDasharray={`${dash} ${circ}`} strokeLinecap="round"
          transform="rotate(-90 90 90)"
        />
      </>
    );
  };
  const overallColor = tone(overallSpent, overallTotal, C.ringGreen);
  const needsColor = tone(needsSpent, needsTotal, C.ringBlue);
  const wantsColor = tone(wantsSpent, wantsTotal, C.ringPurple);
  return (
    <div className="flex items-center gap-6 flex-wrap justify-center sm:justify-start">
      <svg width="180" height="180" viewBox="0 0 180 180">
        {arc(r1, pct(overallSpent, overallTotal), overallColor)}
        {arc(r2, pct(needsSpent, needsTotal), needsColor)}
        {arc(r3, pct(wantsSpent, wantsTotal), wantsColor)}
        {[...Array(12)].map((_, i) => {
          const a = (i * 30 * Math.PI) / 180;
          const x1 = 90 + 84 * Math.cos(a), y1 = 90 + 84 * Math.sin(a);
          const x2 = 90 + 88 * Math.cos(a), y2 = 90 + 88 * Math.sin(a);
          return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke={C.brassLight} strokeWidth="1.5" />;
        })}
      </svg>
      <div className="space-y-3">
        <Legend color={overallColor} label="Overall Spend" spent={overallSpent} total={overallTotal} symbol={symbol} overspent={overallSpent > overallTotal && overallTotal > 0} />
        <Legend color={needsColor} label="Needs (Flex)" spent={needsSpent} total={needsTotal} symbol={symbol} overspent={needsSpent > needsTotal && needsTotal > 0} />
        <Legend color={wantsColor} label="Wants Budget" spent={wantsSpent} total={wantsTotal} symbol={symbol} overspent={wantsSpent > wantsTotal && wantsTotal > 0} />
      </div>
    </div>
  );
}

function Legend({ color, label, spent, total, symbol, overspent }) {
  return (
    <div>
      <div className="flex items-center gap-2">
        <span className="w-2.5 h-2.5 rounded-full" style={{ background: color }} />
        <span className="text-xs" style={{ color: C.slate, fontFamily: "'Public Sans', sans-serif" }}>{label}</span>
        {overspent && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full" style={{ background: C.dangerBg, color: C.danger }}>OVER</span>}
      </div>
      <div className="text-sm font-bold tabular-nums pl-4 ml-0.5" style={{ color, fontFamily: "'IBM Plex Mono', monospace" }}>
        {fmt(spent, symbol)} <span style={{ color: C.slate, fontWeight: 500 }}>/</span> {fmt(total, symbol)}
      </div>
    </div>
  );
}

function NavBar({ view, setView }) {
  const items = [
    { id: "dashboard", label: "Dashboard", icon: Home },
    { id: "diary", label: "Diary", icon: BookOpen },
    { id: "strategy", label: "Strategy", icon: Target },
    { id: "profile", label: "Profile", icon: User },
  ];
  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-40 flex justify-around items-center py-2 px-2 lg:max-w-md lg:left-1/2 lg:-translate-x-1/2 lg:rounded-t-2xl lg:bottom-0"
      style={{ background: C.ink, borderTop: `1px solid ${C.ink}` }}
    >
      {items.map((it) => {
        const active = view === it.id;
        const Icon = it.icon;
        return (
          <button
            key={it.id}
            onClick={() => setView(it.id)}
            className="flex flex-col items-center gap-1 px-4 py-1.5 rounded-xl transition-colors"
            style={{ background: active ? "#2B3A32" : "transparent" }}
          >
            <Icon size={20} color={active ? C.brassLight : "#8A9490"} />
            <span
              className="text-[10px] font-semibold tracking-wide"
              style={{ color: active ? C.brassLight : "#8A9490", fontFamily: "'Public Sans', sans-serif" }}
            >
              {it.label}
            </span>
          </button>
        );
      })}
    </nav>
  );
}

function ItemModal({ onClose, onSave, forceTarget }) {
  const [type, setType] = useState("need");
  const [name, setName] = useState("");
  const [cost, setCost] = useState("");
  const [hasTarget, setHasTarget] = useState(!!forceTarget);
  const [targetDate, setTargetDate] = useState("");

  const submit = () => {
    if (!name.trim() || !cost) return;
    onSave({
      id: uid(), type, name: name.trim(), cost: Number(cost),
      targetDate: hasTarget && targetDate ? targetDate : null,
      purchased: false, createdAt: todayISO(),
    });
    onClose();
  };
  return (
    <Modal title={forceTarget ? "Add a new target item" : "Add a want or need"} onClose={onClose}>
      <Field label="Category Type">
        <PillToggle options={[{ value: "need", label: "Need" }, { value: "want", label: "Want" }]} value={type} onChange={setType} />
      </Field>
      <Field label="Item Name"><TextInput placeholder="e.g. TNG Auto Reload, New Laptop" value={name} onChange={(e) => setName(e.target.value)} /></Field>
      <Field label="Cost"><TextInput type="number" placeholder="0.00" value={cost} onChange={(e) => setCost(e.target.value)} /></Field>
      <label className="flex items-center gap-2 mb-4 text-sm" style={{ color: C.inkSoft, fontFamily: "'Public Sans', sans-serif" }}>
        <input type="checkbox" checked={hasTarget} onChange={(e) => setHasTarget(e.target.checked)} />
        Set a purchase target date
      </label>
      {hasTarget && (
        <Field label="Target date">
          <TextInput type="date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} min={todayISO()} />
        </Field>
      )}
      <Btn variant="accent" className="w-full mt-1" onClick={submit}>
        <Check size={16} /> Save Item
      </Btn>
    </Modal>
  );
}

function ExpenseModal({ onClose, onSave }) {
  const [type, setType] = useState("fixed");
  const [category, setCategory] = useState("needs");
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [freq, setFreq] = useState("month");
  const submit = () => {
    if (!name.trim() || !amount) return;
    onSave({ id: uid(), type, category, name: name.trim(), amount: Number(amount), freq });
    onClose();
  };
  return (
    <Modal title="Add recurring expense" onClose={onClose}>
      <Field label="Expense Type">
        <PillToggle options={[{ value: "fixed", label: "Fixed (Pre-deducted)" }, { value: "variable", label: "Variable" }]} value={type} onChange={setType} />
      </Field>
      <Field label="Budget Category">
        <PillToggle options={[{ value: "needs", label: "Needs" }, { value: "wants", label: "Wants" }]} value={category} onChange={setCategory} />
      </Field>
      <Field label="Expense Name"><TextInput placeholder="e.g. TNG Card RM50, Netflix, Rent" value={name} onChange={(e) => setName(e.target.value)} /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Amount"><TextInput type="number" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
        <Field label="Frequency">
          <Select value={freq} onChange={(e) => setFreq(e.target.value)} options={EXP_FREQS.map((f) => ({ value: f, label: `/ ${f}` }))} />
        </Field>
      </div>
      <p className="text-xs text-slate-500 mb-3" style={{ color: C.slate, fontFamily: "'Public Sans', sans-serif" }}>
        * Fixed & Variable Needs expenses are automatically deducted from your Needs budget so you never overspend.
      </p>
      <Btn variant="accent" className="w-full mt-1" onClick={submit}><Check size={16} /> Save Expense</Btn>
    </Modal>
  );
}

function LogModal({ onClose, onSave, currencySymbol }) {
  const [type, setType] = useState("expense");
  const [category, setCategory] = useState("needs");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const submit = () => {
    if (!amount) return;
    onSave({
      id: uid(), type, category: type === "income" ? "income" : category,
      amount: Number(amount), note: note.trim(), date: todayISO(),
    });
    onClose();
  };
  return (
    <Modal title="Quick Log Transaction" onClose={onClose}>
      <Field label="Transaction Type">
        <PillToggle options={[{ value: "expense", label: "Expense" }, { value: "income", label: "Income" }]} value={type} onChange={setType} />
      </Field>
      {type === "expense" && (
        <Field label="Category">
          <PillToggle options={[{ value: "needs", label: "Needs" }, { value: "wants", label: "Wants" }]} value={category} onChange={setCategory} />
        </Field>
      )}
      <Field label={`Amount (${currencySymbol})`}><TextInput type="number" autoFocus placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
      <Field label="Note (optional)"><TextInput placeholder="e.g. Lunch, Coffee, TNG reload" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      <Btn variant="accent" className="w-full mt-1" onClick={submit}><Check size={16} /> Save Log</Btn>
    </Modal>
  );
}

function AllowanceModal({ profile, onClose, onSave }) {
  const [amount, setAmount] = useState(profile.allowance);
  const [currency, setCurrency] = useState(profile.currency);
  const submit = () => { onSave({ amount: Number(amount) || 0, currency }); onClose(); };
  return (
    <Modal title="Allowance Settings" onClose={onClose}>
      <p className="text-sm mb-4" style={{ color: C.inkSoft, fontFamily: "'Public Sans', sans-serif" }}>
        Update your {profile.frequency.toLowerCase()} allowance and currency below:
      </p>
      <Field label="Currency">
        <Select value={currency} onChange={(e) => setCurrency(e.target.value)} options={CURRENCIES.map((c) => ({ value: c.code, label: `${c.code} (${c.symbol})` }))} />
      </Field>
      <Field label={`Allowance (${symbolFor(currency)})`}>
        <TextInput type="number" autoFocus value={amount} onChange={(e) => setAmount(e.target.value)} />
      </Field>
      <Btn variant="accent" className="w-full mt-1" onClick={submit}><Check size={16} /> Save Changes</Btn>
    </Modal>
  );
}

const SNOOZE_PRESETS = [1, 3, 7, 14, 30];

function AllowanceReminderModal({ profile, symbol, onClose, onSetAmount, onLeaveSame, onSnooze }) {
  const [mode, setMode] = useState("choose");
  const [amount, setAmount] = useState(profile.allowance);
  const [snoozeDays, setSnoozeDays] = useState(7);
  const [useCustomDate, setUseCustomDate] = useState(false);
  const [customDate, setCustomDate] = useState("");

  if (mode === "setAmount") {
    return (
      <Modal title="Set new allowance" onClose={onClose}>
        <Field label={`Allowance (${symbol})`}>
          <TextInput type="number" autoFocus value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <Btn variant="accent" className="w-full mt-1" onClick={() => onSetAmount(Number(amount) || 0)}>
          <Check size={16} /> Confirm amount
        </Btn>
      </Modal>
    );
  }

  if (mode === "snooze") {
    return (
      <Modal title="Remind me again" onClose={onClose}>
        <label className="flex items-center gap-2 mb-4 text-sm" style={{ color: C.inkSoft, fontFamily: "'Public Sans', sans-serif" }}>
          <input type="checkbox" checked={useCustomDate} onChange={(e) => setUseCustomDate(e.target.checked)} />
          Pick a specific date instead
        </label>
        {useCustomDate ? (
          <Field label="Remind me on">
            <TextInput type="date" value={customDate} onChange={(e) => setCustomDate(e.target.value)} min={todayISO()} />
          </Field>
        ) : (
          <Field label="Remind me in">
            <Select value={snoozeDays} onChange={(e) => setSnoozeDays(Number(e.target.value))}
              options={SNOOZE_PRESETS.map((d) => ({ value: d, label: `${d} day${d === 1 ? "" : "s"}` }))} />
          </Field>
        )}
        <Btn variant="accent" className="w-full mt-1" disabled={useCustomDate && !customDate}
          onClick={() => onSnooze({ fromIso: todayISO(), days: snoozeDays, explicitDate: useCustomDate ? customDate : null })}>
          <Check size={16} /> Confirm
        </Btn>
      </Modal>
    );
  }

  return (
    <Modal title="Time to re-input your allowance" onClose={onClose}>
      <p className="text-sm mb-4" style={{ color: C.inkSoft, fontFamily: "'Public Sans', sans-serif" }}>
        Has your {profile.frequency.toLowerCase()} allowance changed (OT, bonus, deductions)?
      </p>
      <div className="space-y-2">
        <Btn variant="accent" className="w-full" onClick={() => setMode("setAmount")}>Set amount</Btn>
        <Btn variant="ghost" className="w-full" onClick={onLeaveSame}>Leave the same</Btn>
        <Btn variant="ghost" className="w-full" onClick={() => setMode("snooze")}>Remind me again</Btn>
      </div>
    </Modal>
  );
}

function MacroCheckInModal({ profile, logs, budgetSplit, expenses, symbol, onClose, onApplyRecommendation }) {
  const past7DaysLogs = useMemo(() => {
    const sevenDaysAgo = addDays(todayISO(), -7);
    return logs.filter((l) => l.date >= sevenDaysAgo && l.type === "expense");
  }, [logs]);

  const spentNeeds7 = past7DaysLogs.filter((l) => l.category === "needs").reduce((s, l) => s + l.amount, 0);
  const spentWants7 = past7DaysLogs.filter((l) => l.category === "wants").reduce((s, l) => s + l.amount, 0);
  const totalSpent7 = spentNeeds7 + spentWants7;

  const daysInPeriod = FREQ_DAYS[profile.frequency] || 30;
  const daysPassed = Math.min(daysInPeriod, Math.max(1, daysBetween(profile.lastAllowanceUpdate, todayISO())));
  const daysRemaining = Math.max(1, daysInPeriod - daysPassed);

  const totalAllowance = Number(profile.allowance) || 0;
  const periodLogs = logs.filter((l) => l.date >= profile.lastAllowanceUpdate);
  const totalSpentPeriod = periodLogs.filter((l) => l.type === "expense").reduce((s, l) => s + l.amount, 0);
  const totalIncomePeriod = periodLogs.filter((l) => l.type === "income").reduce((s, l) => s + l.amount, 0);
  const remainingCash = Math.max(0, totalAllowance + totalIncomePeriod - totalSpentPeriod);

  const targetWeeklySpend = totalAllowance / (daysInPeriod / 7);
  const weeklyVariance = totalSpent7 - targetWeeklySpend;

  const recommendedDailyCap = (remainingCash / daysRemaining).toFixed(2);
  const committedNeedsMonthly = expenses
    .filter((e) => e.category === "needs")
    .reduce((s, e) => s + expenseMonthly(e.amount, e.freq), 0);

  const smartSplitRecommendation = useMemo(() => {
    return suggestSplit(committedNeedsMonthly, allowanceMonthly(totalAllowance, profile.frequency));
  }, [committedNeedsMonthly, totalAllowance, profile.frequency]);

  return (
    <Modal title="Weekly Strategy Check-In" onClose={onClose}>
      <div className="space-y-4">
        <div className="p-3.5 rounded-xl border flex items-center gap-3" style={{ background: C.mossBg, borderColor: C.mossLight }}>
          <Zap size={22} color={C.moss} className="shrink-0" />
          <div>
            <div className="text-xs font-bold uppercase tracking-wide" style={{ color: C.moss }}>Macro Strategy Audit</div>
            <div className="text-xs" style={{ color: C.inkSoft }}>Analyzed performance from the past 7 days</div>
          </div>
        </div>

        <Card className="space-y-2">
          <div className="text-xs font-semibold uppercase tracking-wide" style={{ color: C.slate }}>Past 7 Days Spent</div>
          <div className="flex justify-between items-baseline">
            <span className="text-2xl font-bold tabular-nums" style={{ fontFamily: "'IBM Plex Mono', monospace", color: C.ink }}>
              {fmt(totalSpent7, symbol)}
            </span>
            <span className="text-xs font-semibold" style={{ color: weeklyVariance > 0 ? C.danger : C.moss }}>
              {weeklyVariance > 0 ? `+${fmt(weeklyVariance, symbol)} over target pace` : `${fmt(Math.abs(weeklyVariance), symbol)} under target pace`}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2 text-xs pt-2 border-t" style={{ borderColor: C.line }}>
            <div><span style={{ color: C.slate }}>Needs (Flex):</span> <strong>{fmt(spentNeeds7, symbol)}</strong></div>
            <div><span style={{ color: C.slate }}>Wants:</span> <strong>{fmt(spentWants7, symbol)}</strong></div>
          </div>
        </Card>

        <Card style={{ background: C.brassBg, borderColor: `${C.brass}55` }}>
          <div className="flex items-center gap-1.5 mb-1.5 text-xs font-bold uppercase tracking-wide" style={{ color: C.brass }}>
            <Sparkles size={14} /> MacroFactor Recommendation
          </div>
          <p className="text-xs leading-relaxed mb-3" style={{ color: C.ink }}>
            {remainingCash > 0 ? (
              <>You have <strong>{fmt(remainingCash, symbol)}</strong> remaining for the next <strong>{daysRemaining} days</strong>. We recommend capping discretionary daily spend to <strong>{symbol}{recommendedDailyCap}/day</strong> to finish on target.</>
            ) : (
              <>You have exhausted your allowance for this period. Recommend pausing non-essential Wants until the next allowance deposit.</>
            )}
          </p>

          <div className="p-2.5 rounded-lg bg-white/70 border text-xs mb-3" style={{ borderColor: C.line }}>
            <div className="font-semibold mb-1" style={{ color: C.ink }}>Suggested Split Rebalance:</div>
            <div className="flex justify-between font-mono" style={{ color: C.inkSoft }}>
              <span>Needs: {smartSplitRecommendation.needs}%</span>
              <span>Wants: {smartSplitRecommendation.wants}%</span>
              <span>Savings: {smartSplitRecommendation.savings}%</span>
            </div>
          </div>

          <Btn
            variant="accent"
            className="w-full text-xs"
            onClick={() => onApplyRecommendation({ split: smartSplitRecommendation, dailyCap: Number(recommendedDailyCap) })}
          >
            Apply Smart Rebalance & Finish Check-In
          </Btn>
        </Card>
      </div>
    </Modal>
  );
}

function ResetConfirmModal({ onClose, onConfirm }) {
  return (
    <Modal title="Reset all data?" onClose={onClose}>
      <div className="flex items-center gap-3 p-3 rounded-xl mb-4" style={{ background: C.dangerBg }}>
        <AlertTriangle size={24} color={C.danger} className="shrink-0" />
        <p className="text-xs font-semibold" style={{ color: C.danger, fontFamily: "'Public Sans', sans-serif" }}>
          This will permanently delete all logs, items, expenses, and settings and restart onboarding.
        </p>
      </div>
      <div className="flex gap-2">
        <Btn variant="ghost" className="flex-1" onClick={onClose}>Cancel</Btn>
        <Btn variant="danger" className="flex-1" onClick={() => { onConfirm(); onClose(); }}>Yes, reset</Btn>
      </div>
    </Modal>
  );
}

function EditDateModal({ item, onClose, onSave }) {
  const [date, setDate] = useState(item?.targetDate || "");
  return (
    <Modal title={`Change date — ${item?.name}`} onClose={onClose} z={70}>
      <Field label="Purchase by">
        <TextInput type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </Field>
      <div className="flex gap-2">
        <Btn variant="ghost" className="flex-1" onClick={() => { onSave(null); onClose(); }}>Clear date</Btn>
        <Btn variant="accent" className="flex-1" onClick={() => { onSave(date || null); onClose(); }}>Save</Btn>
      </div>
    </Modal>
  );
}

function SwipeCard({ children, onSwipeRight, onSwipeLeft, onTap, rightHint = "Delete", leftHint = "Done ✓", rightColor = C.danger, leftColor = C.moss }) {
  const [dx, setDx] = useState(0);
  const draggingRef = React.useRef(false);
  const startXRef = React.useRef(0);
  const movedRef = React.useRef(false);
  const threshold = 84;

  function onPointerDown(e) {
    draggingRef.current = true;
    startXRef.current = e.clientX;
    movedRef.current = false;
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch (err) {}
  }
  function onPointerMove(e) {
    if (!draggingRef.current) return;
    const delta = e.clientX - startXRef.current;
    if (Math.abs(delta) > 4) movedRef.current = true;
    setDx(delta);
  }
  function onPointerUp() {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    if (dx > threshold) onSwipeRight && onSwipeRight();
    else if (dx < -threshold) onSwipeLeft && onSwipeLeft();
    setDx(0);
  }
  function onPointerLeave() {
    if (draggingRef.current) { draggingRef.current = false; setDx(0); }
  }
  function handleClick() {
    if (!movedRef.current) onTap && onTap();
  }
  return (
    <div className="relative overflow-hidden rounded-xl select-none">
      <div className="absolute inset-0 flex items-center justify-between px-4 text-white text-xs font-bold"
        style={{ background: dx > 10 ? rightColor : dx < -10 ? leftColor : "transparent" }}>
        <span style={{ opacity: dx > 10 ? 1 : 0 }}>{rightHint}</span>
        <span style={{ opacity: dx < -10 ? 1 : 0 }}>{leftHint}</span>
      </div>
      <div
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}
        onPointerLeave={onPointerLeave} onClick={handleClick}
        style={{ transform: `translateX(${dx}px)`, transition: draggingRef.current ? "none" : "transform 0.2s ease", touchAction: "pan-y", cursor: onTap ? "pointer" : "grab" }}
      >
        {children}
      </div>
    </div>
  );
}

function Onboarding({ onComplete }) {
  const [step, setStep] = useState(0);
  const [currency, setCurrency] = useState("MYR");
  const [frequency, setFrequency] = useState("Monthly");
  const [allowance, setAllowance] = useState("");
  const [items, setItems] = useState([]);
  const [expenses, setExpenses] = useState([
    // { id: uid(), type: "fixed", category: "needs", name: "TNG Card / Transit", amount: 50, freq: "month" }
  ]);
  const [split, setSplit] = useState({ needs: 50, wants: 30, savings: 20 });
  const [splitTouched, setSplitTouched] = useState(false);
  const [showItemModal, setShowItemModal] = useState(false);
  const [showExpenseModal, setShowExpenseModal] = useState(false);
  const [name, setName] = useState("");
  const symbol = symbolFor(currency);

  const needsMonthly = expenses.filter(e => e.category === "needs").reduce((s, e) => s + expenseMonthly(e.amount, e.freq), 0);
  const allowMonthly = allowanceMonthly(Number(allowance) || 0, frequency);
  const suggested = useMemo(() => suggestSplit(needsMonthly, allowMonthly), [needsMonthly, allowMonthly]);

  useEffect(() => {
    if (!splitTouched && step === 3) setSplit(suggested);
  }, [step, splitTouched, suggested]);

  const steps = ["Allowance", "Wants & needs", "Expenses", "Budget split", "Profile"];

  const finish = () => {
    const today = todayISO();
    onComplete({
      profile: {
        name: name.trim() || "You", currency, frequency, allowance: Number(allowance) || 0,
        lastAllowanceUpdate: today, memberSince: today, totalReceived: Number(allowance) || 0,
        checkInDay: 1, nextCheckInDate: nextWeekday(today, 1), isGoogleConnected: false,
        savingsPool: 0, wantsPool: 0, allowanceReminderSnoozed: false,
        nextAllowanceReminderDate: computeNextAllowanceReminderDate(today, frequency),
      },
      items, expenses, budgetSplit: split, suggestedSplit: suggested,
    });
  };

  return (
    <div className="min-h-screen flex flex-col" style={{ background: C.paper }}>
      <div className="max-w-md mx-auto w-full px-5 pt-8 pb-28 flex-1">
        <div className="flex items-center gap-1.5 mb-1">
          <Wallet size={18} color={C.brass} />
          <span className="text-xs font-bold tracking-widest uppercase" style={{ color: C.brass, fontFamily: "'Public Sans', sans-serif" }}>Ledger Budget</span>
        </div>
        <h1 className="text-2xl mb-1" style={{ fontFamily: "'Fraunces', serif", color: C.ink, fontWeight: 600 }}>
          {steps[step]}
        </h1>
        <div className="flex gap-1.5 mb-7">
          {steps.map((_, i) => (
            <div key={i} className="h-1.5 flex-1 rounded-full" style={{ background: i <= step ? C.moss : C.line }} />
          ))}
        </div>

        {step === 0 && (
          <>
            <Field label="Currency">
              <Select value={currency} onChange={(e) => setCurrency(e.target.value)} options={CURRENCIES.map((c) => ({ value: c.code, label: `${c.code} (${c.symbol})` }))} />
            </Field>
            <Field label="Allowance frequency">
              <PillToggle options={FREQUENCIES.map((f) => ({ value: f, label: f }))} value={frequency} onChange={setFrequency} />
            </Field>
            <Field label={`Allowance amount (${symbol})`}>
              <TextInput type="number" placeholder="e.g. 1000.00" value={allowance} onChange={(e) => setAllowance(e.target.value)} />
            </Field>
            <p className="text-xs mt-2" style={{ color: C.slate, fontFamily: "'Public Sans', sans-serif" }}>
              We'll prompt you for check-ins based on your {frequency.toLowerCase()} schedule.
            </p>
          </>
        )}

        {step === 1 && (
          <>
            <p className="text-sm mb-4" style={{ color: C.inkSoft, fontFamily: "'Public Sans', sans-serif" }}>
              Add target items you need or want to buy.
            </p>
            <div className="space-y-2 mb-4">
              {items.length === 0 && <EmptyRow text="Nothing added yet" />}
              {items.map((it) => (
                <RowItem key={it.id} tone={it.type === "need" ? C.moss : C.clay} title={it.name}
                  subtitle={`${it.type} · ${fmt(it.cost, symbol)}${it.targetDate ? ` · by ${it.targetDate}` : ""}`}
                  onDelete={() => setItems(items.filter((x) => x.id !== it.id))} />
              ))}
            </div>
            <Btn variant="ghost" className="w-full" onClick={() => setShowItemModal(true)}><Plus size={16} /> Add target item</Btn>
            {showItemModal && <ItemModal onClose={() => setShowItemModal(false)} onSave={(it) => setItems((p) => [...p, it])} />}
          </>
        )}

        {step === 2 && (
          <>
            <p className="text-sm mb-4" style={{ color: C.inkSoft, fontFamily: "'Public Sans', sans-serif" }}>
              Fixed expenses (like TNG RM50) are automatically subtracted from your Needs budget so you don't overspend.
            </p>
            <div className="space-y-2 mb-4">
              {expenses.length === 0 && <EmptyRow text="No recurring expenses added yet" />}
              {expenses.map((ex) => (
                <RowItem key={ex.id} tone={ex.type === "fixed" ? C.brass : C.slate} title={ex.name}
                  subtitle={`${ex.type} ${ex.category} · ${fmt(ex.amount, symbol)} / ${ex.freq}`}
                  onDelete={() => setExpenses(expenses.filter((x) => x.id !== ex.id))} />
              ))}
            </div>
            <Btn variant="ghost" className="w-full" onClick={() => setShowExpenseModal(true)}><Plus size={16} /> Add recurring expense</Btn>
            {showExpenseModal && <ExpenseModal onClose={() => setShowExpenseModal(false)} onSave={(ex) => setExpenses((p) => [...p, ex])} />}
          </>
        )}

        {step === 3 && (
          <>
            <div className="flex items-center gap-2 mb-3">
              <Sparkles size={16} color={C.brass} />
              <p className="text-sm" style={{ color: C.inkSoft, fontFamily: "'Public Sans', sans-serif" }}>
                Suggested split (50/30/20 standard baseline).
              </p>
            </div>
            <Card className="space-y-3">
              {["needs", "wants", "savings"].map((k) => (
                <div key={k}>
                  <div className="flex items-center gap-3">
                    <span className="w-20 text-sm font-semibold capitalize" style={{ color: C.ink, fontFamily: "'Public Sans', sans-serif" }}>{k}</span>
                    <input type="range" min="0" max="100" value={split[k]}
                      onChange={(e) => { setSplitTouched(true); setSplit((s) => ({ ...s, [k]: Number(e.target.value) })); }}
                      className="flex-1" />
                    <span className="w-12 text-right text-sm font-bold tabular-nums" style={{ fontFamily: "'IBM Plex Mono', monospace", color: C.ink }}>{split[k]}%</span>
                  </div>
                  <div className="text-right text-[11px] pr-[3.75rem]" style={{ color: C.slate, fontFamily: "'Public Sans', sans-serif" }}>
                    suggested {suggested[k]}% ({fmt((allowMonthly * suggested[k]) / 100, symbol)})
                  </div>
                </div>
              ))}
              <div className="text-xs text-right" style={{ color: split.needs + split.wants + split.savings === 100 ? C.moss : C.danger, fontFamily: "'Public Sans', sans-serif" }}>
                Total: {split.needs + split.wants + split.savings}%
              </div>
            </Card>
          </>
        )}

        {step === 4 && (
          <>
            <Field label="Your name">
              <TextInput placeholder="e.g. Kaiser" value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Card className="mt-2">
              <div className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: C.slate, fontFamily: "'Public Sans', sans-serif" }}>Summary</div>
              <SummaryRow label="Allowance" value={`${fmt(allowance, symbol)} / ${frequency}`} />
              <SummaryRow label="Items" value={`${items.length} added`} />
              <SummaryRow label="Expenses" value={`${expenses.length} added (${fmt(needsMonthly, symbol)}/mo committed)`} />
              <SummaryRow label="Split" value={`${split.needs}% needs · ${split.wants}% wants · ${split.savings}% savings`} />
            </Card>
          </>
        )}
      </div>

      <div className="fixed bottom-0 left-0 right-0 p-4 flex gap-3 max-w-md mx-auto" style={{ background: `linear-gradient(to top, ${C.paper} 60%, transparent)` }}>
        {step > 0 && <Btn variant="ghost" onClick={() => setStep((s) => s - 1)}>Back</Btn>}
        {step < 4 ? (
          <Btn variant="primary" className="flex-1" onClick={() => setStep((s) => s + 1)} disabled={step === 0 && !allowance}>
            Continue <ChevronRight size={16} />
          </Btn>
        ) : (
          <Btn variant="accent" className="flex-1" onClick={finish} disabled={!name.trim()}>
            Create Profile <Check size={16} />
          </Btn>
        )}
      </div>
    </div>
  );
}

function SummaryRow({ label, value }) {
  return (
    <div className="flex justify-between py-1 text-sm" style={{ fontFamily: "'Public Sans', sans-serif" }}>
      <span style={{ color: C.slate }}>{label}</span>
      <span style={{ color: C.ink, fontWeight: 600 }}>{value}</span>
    </div>
  );
}
function EmptyRow({ text }) {
  return <div className="text-sm text-center py-4 rounded-xl" style={{ color: C.slate, background: C.paperDark, fontFamily: "'Public Sans', sans-serif" }}>{text}</div>;
}
function RowItem({ tone, title, subtitle, onDelete, right }) {
  return (
    <div className="flex items-center gap-3 p-3 rounded-xl" style={{ background: C.card, border: `1px solid ${C.line}` }}>
      <span className="w-1.5 h-8 rounded-full shrink-0" style={{ background: tone }} />
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold truncate" style={{ color: C.ink, fontFamily: "'Public Sans', sans-serif" }}>{title}</div>
        <div className="text-xs truncate" style={{ color: C.slate, fontFamily: "'Public Sans', sans-serif" }}>{subtitle}</div>
      </div>
      {right}
      {onDelete && (
        <button onClick={onDelete} className="p-1.5 rounded-full shrink-0" style={{ background: C.paperDark }}>
          <Trash2 size={14} color={C.danger} />
        </button>
      )}
    </div>
  );
}

function Dashboard({ state, symbol, dueSoon, onOpenLog, onCheckIn, setView }) {
  const { profile, items, expenses, logs, budgetSplit } = state;
  const periodStart = profile.lastAllowanceUpdate;
  const periodLogs = logs.filter((l) => l.date >= periodStart);

  const totalAllowance = Number(profile.allowance) || 0;
  const committedNeedsMonthly = expenses
    .filter((e) => e.category === "needs")
    .reduce((s, e) => s + expenseMonthly(e.amount, e.freq), 0);
  
  const committedNeedsPeriod = (committedNeedsMonthly / 30) * (FREQ_DAYS[profile.frequency] || 30);

  const grossNeedsBudget = (totalAllowance * budgetSplit.needs) / 100;
  const wantsBudget = (totalAllowance * budgetSplit.wants) / 100;
  const savingsBudget = (totalAllowance * budgetSplit.savings) / 100;

  const flexNeedsBudget = Math.max(0, grossNeedsBudget - committedNeedsPeriod);
  const periodDays = FREQ_DAYS[profile.frequency] || 30;
  const dailyFlexNeeds = profile.dailyNeedsCap != null ? profile.dailyNeedsCap : flexNeedsBudget / periodDays;
  const dailyWants = profile.dailyWantsCap != null ? profile.dailyWantsCap : wantsBudget / periodDays;
  const dailyTotal = profile.dailyCapOverride != null ? profile.dailyCapOverride : dailyFlexNeeds + dailyWants;
  const today = todayISO();
  const todaySpentNeeds = logs.filter((l) => l.date === today && l.type === "expense" && l.category === "needs").reduce((s, l) => s + l.amount, 0);
  const todaySpentWants = logs.filter((l) => l.date === today && l.type === "expense" && l.category === "wants").reduce((s, l) => s + l.amount, 0);
  const todaySpentTotal = todaySpentNeeds + todaySpentWants;

  const spentNeeds = periodLogs.filter((l) => l.type === "expense" && l.category === "needs").reduce((s, l) => s + l.amount, 0);
  const spentWants = periodLogs.filter((l) => l.type === "expense" && l.category === "wants").reduce((s, l) => s + l.amount, 0);
  const totalSpent = spentNeeds + spentWants;

  const balance = computeBalance(profile, logs);
  const overspent = flexNeedsBudget > 0 && spentNeeds > flexNeedsBudget;
  const safeToSpend = Math.max(0, dailyTotal - todaySpentTotal);
  const pacePct = dailyTotal > 0 ? todaySpentTotal / dailyTotal : 0;
  const paceStatus = pacePct > 1 ? "over" : pacePct >= 0.75 ? "near" : "under";
  const paceColor = { over: C.danger, near: C.brass, under: C.moss }[paceStatus];
  const paceLabel = { over: "Over cap", near: "Nearing cap", under: "Under pace" }[paceStatus];

  const recent = [...logs].sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 5);

  const categoryData = [
    { name: "Needs (Flex)", value: spentNeeds, color: C.ringBlue },
    { name: "Wants", value: spentWants, color: C.ringPurple },
  ].filter((d) => d.value > 0);

  const last7 = [...Array(7)].map((_, i) => {
    const d = new Date(); d.setDate(d.getDate() - (6 - i));
    const iso = toLocalISODate(d);
    const total = logs.filter((l) => l.type === "expense" && l.date === iso).reduce((s, l) => s + l.amount, 0);
    return { day: d.toLocaleDateString(undefined, { weekday: "short" }), total: Number(total.toFixed(2)) };
  });

  return (
    <div className="max-w-md lg:max-w-5xl mx-auto px-5 pt-8 pb-28 lg:grid lg:grid-cols-[1fr_360px] lg:gap-8">
      <div>
        <div className="flex items-center justify-between mb-5">
          <div>
            <div className="text-xs font-bold tracking-widest uppercase flex items-center gap-1.5" style={{ color: C.brass, fontFamily: "'Public Sans', sans-serif" }}>
              Dashboard {profile.tier === "premium" && <span className="px-1.5 py-0.5 rounded text-[9px] bg-amber-200 text-amber-900 font-bold">PRO</span>}
            </div>
            <h1 className="text-2xl" style={{ fontFamily: "'Fraunces', serif", color: C.ink, fontWeight: 600 }}>Hi, {profile.name}</h1>
          </div>
          <div className="px-3 py-1.5 rounded-full text-xs font-bold flex items-center gap-1" style={{ background: C.brassBg, color: C.brass, fontFamily: "'IBM Plex Mono', monospace" }}>
            {profile.isGoogleConnected && <Check size={12} color={C.moss} />}
            {profile.currency}
          </div>
        </div>

        {dueSoon && (
          <Banner onAction={onCheckIn} actionLabel="Check in">
            Weekly Macro Strategy Check-in is due!
          </Banner>
        )}
        {overspent && (
          <Banner>
            <span style={{ color: C.danger, fontWeight: 700 }}>
              Caution: Discretionary Needs spend exceeds remaining cap after committed expenses ({fmt(committedNeedsPeriod, symbol)} deducted).
            </span>
          </Banner>
        )}

        {committedNeedsPeriod > 0 && (
          <div className="px-3.5 py-2 rounded-xl text-xs flex justify-between items-center mb-3" style={{ background: C.paperDark, color: C.inkSoft }}>
            <span className="flex items-center gap-1.5">
              <Layers size={14} color={C.brass} />
              Fixed Needs Deducted (TNG, Bills, etc.):
            </span>
            <span className="font-mono font-bold">{fmt(committedNeedsPeriod, symbol)}</span>
          </div>
        )}

        <Card className="mb-4">
          <div className="flex items-center justify-between mb-3">
            <div>
              <div className="text-[10px] uppercase tracking-widest font-bold" style={{ color: C.slate, fontFamily: "'Public Sans', sans-serif" }}>Safe to spend</div>
              <div className="text-2xl font-bold tabular-nums" style={{ color: C.ink, fontFamily: "'IBM Plex Mono', monospace" }}>
                {fmt(safeToSpend, symbol)}<span className="text-sm font-semibold" style={{ color: C.slate }}>/day</span>
              </div>
            </div>
            <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold" style={{ background: `${paceColor}22`, color: paceColor }}>
              <span className="w-2 h-2 rounded-full" style={{ background: paceColor }} />
              {paceLabel}
            </span>
          </div>
          <Rings
            overallSpent={todaySpentTotal} overallTotal={dailyTotal}
            needsSpent={todaySpentNeeds} needsTotal={dailyFlexNeeds}
            wantsSpent={todaySpentWants} wantsTotal={dailyWants}
            symbol={symbol}
          />
          <div className="text-[11px] text-center -mt-1 mb-1" style={{ color: C.slate, fontFamily: "'Public Sans', sans-serif" }}>Today vs. daily caps</div>
          <div className="grid grid-cols-3 gap-2 mt-4 pt-4" style={{ borderTop: `1px solid ${C.line}` }}>
            <Stat label="Spent" value={fmt(totalSpent, symbol)} tone={overspent ? C.danger : undefined} />
            <Stat label="Allowance" value={fmt(totalAllowance, symbol)} />
            <Stat label="Cash Balance" value={fmt(balance, symbol)} tone={balance < 0 ? C.danger : C.moss} />
          </div>
        </Card>

        <div className="flex gap-3 mb-5">
          <Btn variant="accent" className="flex-1" onClick={onOpenLog}><Plus size={16} /> Quick Log</Btn>
          <Btn variant="ghost" onClick={() => setView("diary")}>View Log Diary</Btn>
        </div>

        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-bold uppercase tracking-wide" style={{ color: C.slate, fontFamily: "'Public Sans', sans-serif" }}>Recent Activity</h2>
          <button onClick={() => setView("diary")} className="text-xs font-semibold" style={{ color: C.moss }}>See all</button>
        </div>
        <div className="space-y-2">
          {recent.length === 0 && <EmptyRow text="No logs yet — tap Quick Log to add one" />}
          {recent.map((l) => <LogRow key={l.id} log={l} symbol={symbol} />)}
        </div>
      </div>

      <div className="hidden lg:block">
        <h2 className="text-sm font-bold uppercase tracking-wide mb-3 mt-1" style={{ color: C.slate, fontFamily: "'Public Sans', sans-serif" }}>Analytics</h2>
        <Card className="mb-4">
          <div className="text-xs font-semibold mb-2" style={{ color: C.ink, fontFamily: "'Public Sans', sans-serif" }}>Spending by Category</div>
          {categoryData.length === 0 ? <EmptyRow text="Nothing logged this period" /> : (
            <ResponsiveContainer width="100%" height={180}>
              <PieChart>
                <Pie data={categoryData} dataKey="value" nameKey="name" innerRadius={45} outerRadius={70} paddingAngle={3}>
                  {categoryData.map((d, i) => <Cell key={i} fill={d.color} />)}
                </Pie>
                <Tooltip formatter={(v) => fmt(v, symbol)} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </Card>
        <Card>
          <div className="text-xs font-semibold mb-2" style={{ color: C.ink, fontFamily: "'Public Sans', sans-serif" }}>Last 7 Days Spending</div>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={last7}>
              <CartesianGrid strokeDasharray="3 3" stroke={C.line} />
              <XAxis dataKey="day" tick={{ fontSize: 11, fill: C.slate }} axisLine={{ stroke: C.line }} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: C.slate }} axisLine={false} tickLine={false} />
              <Tooltip formatter={(v) => fmt(v, symbol)} />
              <Bar dataKey="total" fill={C.clay} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Card>
      </div>
    </div>
  );
}

function Stat({ label, value, tone }) {
  return (
    <div>
      <div className="text-[10px] uppercase font-semibold tracking-wide" style={{ color: C.slate, fontFamily: "'Public Sans', sans-serif" }}>{label}</div>
      <div className="text-sm font-bold tabular-nums" style={{ color: tone || C.ink, fontFamily: "'IBM Plex Mono', monospace" }}>{value}</div>
    </div>
  );
}

function LogRow({ log, symbol }) {
  const isIncome = log.type === "income";
  return (
    <div className="flex items-center gap-3 p-3 rounded-xl" style={{ background: C.card, border: `1px solid ${C.line}` }}>
      <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0" style={{ background: isIncome ? C.mossBg : C.clayBg }}>
        {isIncome ? <ArrowUpRight size={15} color={C.moss} /> : <ArrowDownRight size={15} color={C.clay} />}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold truncate" style={{ color: C.ink, fontFamily: "'Public Sans', sans-serif" }}>{log.note || (isIncome ? "Income" : "Expense")}</div>
        <div className="text-xs capitalize" style={{ color: C.slate, fontFamily: "'Public Sans', sans-serif" }}>{log.category} · {log.date}</div>
      </div>
      <div className="text-sm font-bold tabular-nums shrink-0" style={{ color: isIncome ? C.moss : C.ink, fontFamily: "'IBM Plex Mono', monospace" }}>
        {isIncome ? "+" : "−"}{fmt(log.amount, symbol)}
      </div>
    </div>
  );
}
function DiaryLogRow({ log, symbol, onTap, onEdit, onDelete }) {
  return (
    <SwipeCard onSwipeRight={onDelete} onSwipeLeft={onEdit} onTap={onTap} rightHint="Delete" leftHint="Edit" rightColor={C.danger} leftColor={C.brass}>
      <LogRow log={log} symbol={symbol} />
    </SwipeCard>
  );
}
function EditLogModal({ log, onClose, onSave, onDelete }) {
  const [type, setType] = useState(log.type);
  const [category, setCategory] = useState(log.type === "income" ? "income" : log.category);
  const [amount, setAmount] = useState(log.amount);
  const [note, setNote] = useState(log.note || "");
  const [date, setDate] = useState(log.date);
  const submit = () => {
    if (!amount) return;
    onSave({ ...log, type, category: type === "income" ? "income" : category, amount: Number(amount), note: note.trim(), date });
    onClose();
  };
  return (
    <Modal title="Edit log entry" onClose={onClose}>
      <Field label="Type">
        <PillToggle options={[{ value: "expense", label: "Expense" }, { value: "income", label: "Income" }]} value={type} onChange={setType} />
      </Field>
      {type === "expense" && (
        <Field label="Category">
          <PillToggle options={[{ value: "needs", label: "Needs" }, { value: "wants", label: "Wants" }]} value={category} onChange={setCategory} />
        </Field>
      )}
      <Field label="Amount"><TextInput type="number" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
      <Field label="Note"><TextInput value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      <Field label="Date"><TextInput type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
      <Btn variant="accent" className="w-full mt-1 mb-2" onClick={submit}><Check size={16} /> Save changes</Btn>
      <Btn variant="danger" className="w-full" onClick={() => { onDelete(log.id); onClose(); }}><Trash2 size={15} /> Delete entry</Btn>
    </Modal>
  );
}

function Diary({ logs, symbol, onUpdateLog, onDeleteLog }) {
  const [typeFilter, setTypeFilter] = useState("all");
  const [periodFilter, setPeriodFilter] = useState("all");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [editingLog, setEditingLog] = useState(null);

  const filtered = useMemo(() => {
    const now = new Date();
    return logs.filter((l) => {
      if (typeFilter !== "all" && l.type !== typeFilter) return false;
      if (periodFilter === "today" && l.date !== todayISO()) return false;
      if (periodFilter === "week" && daysBetween(l.date, now) > 7) return false;
      if (periodFilter === "month" && daysBetween(l.date, now) > 30) return false;
      if (periodFilter === "custom") {
        if (fromDate && l.date < fromDate) return false;
        if (toDate && l.date > toDate) return false;
      }
      return true;
    }).sort((a, b) => (a.date < b.date ? 1 : -1));
  }, [logs, typeFilter, periodFilter, fromDate, toDate]);

  const grouped = useMemo(() => {
    const g = {};
    filtered.forEach((l) => { (g[l.date] = g[l.date] || []).push(l); });
    return Object.entries(g);
  }, [filtered]);

  function sectionLabel(dateStr) {
    if (dateStr === todayISO()) return "Today";
    if (dateStr === addDays(todayISO(), -1)) return "Yesterday";
    return new Date(dateStr + "T00:00:00").toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  }
  function daySubtotal(entries) {
    const income = entries.filter((l) => l.type === "income").reduce((s, l) => s + l.amount, 0);
    const expense = entries.filter((l) => l.type === "expense").reduce((s, l) => s + l.amount, 0);
    return income - expense;
  }

  return (
    <div className="max-w-md lg:max-w-2xl mx-auto px-5 pt-8 pb-28">
      <div className="text-xs font-bold tracking-widest uppercase mb-1" style={{ color: C.brass, fontFamily: "'Public Sans', sans-serif" }}>Diary</div>
      <h1 className="text-2xl mb-5" style={{ fontFamily: "'Fraunces', serif", color: C.ink, fontWeight: 600 }}>Your log history</h1>

      <div className="flex gap-2 mb-3 flex-wrap">
        <Select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} style={{ width: "auto" }}
          options={[{ value: "all", label: "All types" }, { value: "income", label: "Income" }, { value: "expense", label: "Expense" }]} />
        <Select value={periodFilter} onChange={(e) => setPeriodFilter(e.target.value)} style={{ width: "auto" }}
          options={[{ value: "all", label: "All time" }, { value: "today", label: "Today" }, { value: "week", label: "This week" }, { value: "month", label: "This month" }, { value: "custom", label: "Date range…" }]} />
      </div>
      {periodFilter === "custom" && (
        <div className="grid grid-cols-2 gap-3 mb-5">
          <Field label="From"><TextInput type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} /></Field>
          <Field label="To"><TextInput type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} /></Field>
        </div>
      )}

      {grouped.length === 0 && <EmptyRow text="No logs match these filters" />}
      <div className="space-y-5">
        {grouped.map(([date, entries]) => {
          const subtotal = daySubtotal(entries);
          return (
            <div key={date}>
              <div className="flex items-baseline justify-between mb-2">
                <div className="text-xs font-semibold" style={{ color: C.slate, fontFamily: "'Public Sans', sans-serif" }}>{sectionLabel(date)}</div>
                <div className="text-xs font-bold tabular-nums" style={{ color: subtotal < 0 ? C.danger : C.moss, fontFamily: "'IBM Plex Mono', monospace" }}>
                  {subtotal >= 0 ? "+" : "−"}{fmt(Math.abs(subtotal), symbol)}
                </div>
              </div>
              <div className="space-y-2">
                {entries.map((l) => (
                  <DiaryLogRow key={l.id} log={l} symbol={symbol} onTap={() => setEditingLog(l)} onEdit={() => setEditingLog(l)} onDelete={() => onDeleteLog(l.id)} />
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {editingLog && (
        <EditLogModal log={editingLog} onClose={() => setEditingLog(null)} onSave={onUpdateLog} onDelete={onDeleteLog} />
      )}
    </div>
  );
}

function SplitChip({ label, pct, cashVal, flexCashVal, color }) {
  return (
    <div className="flex-1 p-2.5 rounded-xl border flex flex-col justify-between" style={{ borderColor: C.line, background: C.card }}>
      <div>
        <div className="flex items-center gap-1.5 mb-1">
          <span className="w-2 h-2 rounded-full" style={{ background: color }} />
          <span className="text-xs font-semibold" style={{ color: C.slate, fontFamily: "'Public Sans', sans-serif" }}>{label}</span>
        </div>
        <div className="text-base font-bold" style={{ color: C.ink, fontFamily: "'IBM Plex Mono', monospace" }}>{pct}%</div>
      </div>
      <div className="mt-2 pt-1 border-t text-xs font-semibold" style={{ borderColor: C.line, color: C.inkSoft, fontFamily: "'IBM Plex Mono', monospace" }}>
        {cashVal}
        {flexCashVal && <div className="text-[10px]" style={{ color: C.moss }}>Flex: {flexCashVal}</div>}
      </div>
    </div>
  );
}

function TargetItemCard({ item, symbol, purchasable, onDelete, onComplete, onTap }) {
  const isNeed = item.type === "need";
  return (
    <SwipeCard
      onSwipeRight={onDelete}
      onSwipeLeft={purchasable ? onComplete : undefined}
      onTap={onTap}
      rightHint="Delete"
      leftHint="Buy ✓"
      rightColor={C.danger}
      leftColor={C.moss}
    >
      <div className="flex items-center gap-3 p-3.5 rounded-xl" style={{ background: C.card, border: `1px solid ${C.line}` }}>
        <div className="w-2.5 h-10 rounded-full shrink-0" style={{ background: isNeed ? C.moss : C.clay }} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold truncate" style={{ color: C.ink, fontFamily: "'Public Sans', sans-serif" }}>
              {item.name}
            </span>
            <span className="text-[10px] uppercase font-bold px-1.5 py-0.5 rounded" style={{ background: isNeed ? C.mossBg : C.clayBg, color: isNeed ? C.moss : C.clay }}>
              {item.type}
            </span>
          </div>
          <div className="text-xs mt-0.5" style={{ color: C.slate, fontFamily: "'Public Sans', sans-serif" }}>
            {item.targetDate ? `Target: ${item.targetDate}` : "No target date set"}
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-sm font-bold tabular-nums" style={{ color: C.ink, fontFamily: "'IBM Plex Mono', monospace" }}>
            {fmt(item.cost, symbol)}
          </div>
          {purchasable ? (
            <button
              onClick={(e) => { e.stopPropagation(); onComplete(); }}
              className="mt-1 text-[11px] font-semibold px-2 py-0.5 rounded"
              style={{ background: C.mossBg, color: C.moss }}
            >
              Affordable ✓
            </button>
          ) : (
            <div className="text-[10px]" style={{ color: C.slate }}>Save more</div>
          )}
        </div>
      </div>
    </SwipeCard>
  );
}

function PresetOption({ label, badge, selected, onClick }) {
  return (
    <button onClick={onClick} type="button"
      className="w-full flex items-center justify-between px-3.5 py-2.5 rounded-lg border text-sm font-medium text-left"
      style={{ borderColor: selected ? C.ink : C.line, background: selected ? C.paperDark : C.card, color: C.ink, fontFamily: "'Public Sans', sans-serif" }}>
      <span>{label}</span>
      <span className="flex items-center gap-2">
        {badge && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full whitespace-nowrap" style={{ background: C.brassBg, color: C.brass }}>{badge}</span>}
        {selected && <Check size={14} color={C.moss} />}
      </span>
    </button>
  );
}
function matchPreset(split, suggestedSplit) {
  const eq = (a, b) => a.needs === b.needs && a.wants === b.wants && a.savings === b.savings;
  if (eq(split, suggestedSplit)) return "suggested";
  const m = SPLIT_PRESETS.find((p) => p.split && eq(split, p.split));
  return m ? m.id : "custom";
}
function EditPlanModal({ profile, budgetSplit, suggestedSplit, expenses, logs, symbol, onClose, onSaveSplit, onChangeCheckInDay }) {
  const [tab, setTab] = useState("split");
  const [split, setSplit] = useState(budgetSplit);
  const total = split.needs + split.wants + split.savings;
  const activePresetId = matchPreset(split, suggestedSplit);
  const activeLabel = activePresetId === "suggested" ? "Suggested" : activePresetId === "custom" ? "Custom"
    : SPLIT_PRESETS.find((p) => p.id === activePresetId)?.label || "Custom";

  const totalAllowance = Number(profile.allowance) || 0;
  const periodDays = FREQ_DAYS[profile.frequency] || 30;
  const committedNeedsMonthly = expenses.filter((e) => e.category === "needs").reduce((s, e) => s + expenseMonthly(e.amount, e.freq), 0);
  const committedNeedsPeriod = (committedNeedsMonthly / 30) * periodDays;
  const needsCash = (totalAllowance * budgetSplit.needs) / 100;
  const wantsCash = (totalAllowance * budgetSplit.wants) / 100;
  const dailyFlexNeeds = Math.max(0, needsCash - committedNeedsPeriod) / periodDays;
  const dailyWants = wantsCash / periodDays;
  const today = todayISO();
  const todaySpentNeeds = logs.filter((l) => l.date === today && l.type === "expense" && l.category === "needs").reduce((s, l) => s + l.amount, 0);
  const todaySpentWants = logs.filter((l) => l.date === today && l.type === "expense" && l.category === "wants").reduce((s, l) => s + l.amount, 0);

  return (
    <Modal title="Edit Strategy" onClose={onClose}>
      <div className="flex gap-1 mb-4 rounded-full p-1" style={{ background: C.paperDark }}>
        {[{ id: "split", label: "Split" }, { id: "daily", label: "Daily" }, { id: "checkin", label: "Check-in" }].map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className="flex-1 py-1.5 rounded-full text-sm font-semibold"
            style={{ background: tab === t.id ? C.ink : "transparent", color: tab === t.id ? C.paper : C.slate, fontFamily: "'Public Sans', sans-serif" }}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === "split" && (
        <>
          <div className="space-y-2 mb-3">
            <PresetOption label={`Suggested (${suggestedSplit.needs}/${suggestedSplit.wants}/${suggestedSplit.savings})`} badge="Best match" selected={activePresetId === "suggested"} onClick={() => setSplit(suggestedSplit)} />
            {SPLIT_PRESETS.filter((p) => p.id !== "personal").map((p) => (
              <PresetOption key={p.id} label={`${p.label} (${p.split.needs}/${p.split.wants}/${p.split.savings})`} selected={activePresetId === p.id} onClick={() => setSplit(p.split)} />
            ))}
          </div>
          <div className="text-[11px] font-semibold mb-2" style={{ color: C.slate, fontFamily: "'Public Sans', sans-serif" }}>
            Active: <span style={{ color: C.moss }}>{activeLabel}</span>
          </div>
          <Card className="space-y-3 mb-3">
            {["needs", "wants", "savings"].map((k) => (
              <div key={k} className="flex items-center gap-3">
                <span className="w-20 text-sm font-semibold capitalize" style={{ color: C.ink, fontFamily: "'Public Sans', sans-serif" }}>{k}</span>
                <input type="range" min="0" max="100" value={split[k]} onChange={(e) => setSplit((s) => ({ ...s, [k]: Number(e.target.value) }))} className="flex-1" />
                <span className="w-12 text-right text-sm font-bold tabular-nums" style={{ fontFamily: "'IBM Plex Mono', monospace", color: C.ink }}>{split[k]}%</span>
              </div>
            ))}
            <div className="text-xs text-right" style={{ color: total === 100 ? C.moss : C.danger, fontFamily: "'Public Sans', sans-serif" }}>Total: {total}%</div>
          </Card>
          <Btn variant="accent" className="w-full" disabled={total !== 100} onClick={() => { onSaveSplit(split); onClose(); }}>
            <Check size={16} /> Save plan
          </Btn>
        </>
      )}

      {tab === "daily" && (
        <div className="space-y-3">
          <DailyVelocityRow label="Needs (flex)" spent={todaySpentNeeds} cap={dailyFlexNeeds} symbol={symbol} color={C.ringBlue} />
          <DailyVelocityRow label="Wants" spent={todaySpentWants} cap={dailyWants} symbol={symbol} color={C.ringPurple} />
          <p className="text-[11px]" style={{ color: C.slate, fontFamily: "'Public Sans', sans-serif" }}>
            Daily caps are your period budget (after fixed/variable Needs expenses are deducted) spread evenly across {periodDays} days.
          </p>
        </div>
      )}

      {tab === "checkin" && (
        <>
          <Field label="Weekly check-in day">
            <Select value={profile.checkInDay ?? 1} onChange={(e) => onChangeCheckInDay(Number(e.target.value))} options={WEEKDAYS.map((d, i) => ({ value: i, label: d }))} />
          </Field>
          <p className="text-xs" style={{ color: C.slate, fontFamily: "'Public Sans', sans-serif" }}>
            You'll be prompted to run your weekly Macro Strategy check-in on this day.
          </p>
        </>
      )}
    </Modal>
  );
}
function DailyVelocityRow({ label, spent, cap, symbol, color }) {
  const over = cap > 0 && spent > cap;
  return (
    <Card>
      <div className="flex items-center justify-between mb-1">
        <span className="text-sm font-semibold" style={{ color: C.ink, fontFamily: "'Public Sans', sans-serif" }}>{label}</span>
        <span className="text-xs font-bold" style={{ color: over ? C.danger : C.slate, fontFamily: "'IBM Plex Mono', monospace" }}>
          {fmt(spent, symbol)} / {fmt(cap, symbol)}
        </span>
      </div>
      <div className="h-2 rounded-full" style={{ background: C.line }}>
        <div className="h-2 rounded-full" style={{ width: `${Math.min(100, cap ? (spent / cap) * 100 : 0)}%`, background: over ? C.danger : color }} />
      </div>
    </Card>
  );
}
function WishlistModal({ items, symbol, balance, onClose, onDelete, onComplete, onTap }) {
  const sorted = sortByRelevance(items.filter((i) => !i.purchased), balance);
  return (
    <Modal title="Full wishlist" onClose={onClose}>
      <div className="space-y-2 max-h-[60vh] overflow-y-auto">
        {sorted.length === 0 && <EmptyRow text="Nothing in your wishlist" />}
        {sorted.map((item) => (
          <TargetItemCard key={item.id} item={item} symbol={symbol} purchasable={balance >= item.cost}
            onDelete={() => onDelete(item.id)} onComplete={() => onComplete(item)} onTap={() => onTap(item)} />
        ))}
      </div>
    </Modal>
  );
}
function Strategy({ state, symbol, checkInDue, daysToCheckIn, onCheckIn, onSkipCheckIn, onChangeCheckInDay, onAddItem, onDeleteItem, onEditDate, onMarkPurchased, onUndoPurchase, onDeletePurchase, onSaveSplit }) {
  const { profile, items, expenses, logs, budgetSplit } = state;
  const balance = computeBalance(profile, logs);
  const allowance = Number(profile.allowance) || 0;
  
  const needsCash = (allowance * budgetSplit.needs) / 100;
  const wantsCash = (allowance * budgetSplit.wants) / 100;
  const savingsCash = (allowance * budgetSplit.savings) / 100;

  const committedNeedsMonthly = expenses
    .filter((e) => e.category === "needs")
    .reduce((s, e) => s + expenseMonthly(e.amount, e.freq), 0);
  const committedNeedsPeriod = (committedNeedsMonthly / 30) * (FREQ_DAYS[profile.frequency] || 30);
  const flexNeedsCash = Math.max(0, needsCash - committedNeedsPeriod);

  const suggestedSplit = state.suggestedSplit || suggestSplit(committedNeedsMonthly, allowanceMonthly(allowance, profile.frequency));

  const [editingItem, setEditingItem] = useState(null);
  const [showAddItem, setShowAddItem] = useState(false);
  const [showEditPlan, setShowEditPlan] = useState(false);
  const [showWishlist, setShowWishlist] = useState(false);

  const rankedPending = sortByRelevance(items.filter((i) => !i.purchased), balance);
  const topFive = rankedPending.slice(0, 5);
  const purchasedTargets = items.filter((i) => i.purchased);

  return (
    <div className="max-w-md lg:max-w-2xl mx-auto px-5 pt-8 pb-28">
      <div className="text-xs font-bold tracking-widest uppercase mb-1" style={{ color: C.brass, fontFamily: "'Public Sans', sans-serif" }}>Strategy</div>
      <h1 className="text-2xl mb-4" style={{ fontFamily: "'Fraunces', serif", color: C.ink, fontWeight: 600 }}>Plan & Targets</h1>

      {/* Check-in Card */}
      <Card className="mb-5" style={{ background: checkInDue ? C.brassBg : C.card }}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Zap size={18} color={checkInDue ? C.brass : C.moss} />
            <span className="text-sm font-semibold" style={{ color: C.ink }}>Weekly Macro Strategy</span>
          </div>
          <span className="text-xs font-mono font-bold" style={{ color: C.slate }}>
            {checkInDue ? "DUE NOW" : `In ${daysToCheckIn} days`}
          </span>
        </div>
        <p className="text-xs mt-2 text-slate-600">
          Check in weekly to analyze spending velocity and adapt your budget split according to dynamic MacroFactor recommendations.
        </p>
        <div className="flex gap-2 mt-3">
          <Btn variant="accent" className="flex-1 text-xs" onClick={onCheckIn}>Start Check-In</Btn>
          <Btn variant="ghost" className="text-xs" onClick={onSkipCheckIn}>Snooze 7d</Btn>
        </div>
      </Card>

      {/* Budget Plan */}
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-sm font-bold uppercase tracking-wide" style={{ color: C.slate, fontFamily: "'Public Sans', sans-serif" }}>Current Budget Plan</h2>
        <button onClick={() => setShowEditPlan(true)} className="text-xs font-semibold inline-flex items-center gap-1" style={{ color: C.moss }}>
          <Settings2 size={13} /> Edit Strategy
        </button>
      </div>
      <Card className="mb-5">
        <div className="flex gap-2 mb-3">
          <SplitChip label="Needs" pct={budgetSplit.needs} cashVal={fmt(needsCash, symbol)} flexCashVal={committedNeedsPeriod > 0 ? fmt(flexNeedsCash, symbol) : null} color={C.ringBlue} />
          <SplitChip label="Wants" pct={budgetSplit.wants} cashVal={fmt(wantsCash, symbol)} color={C.ringPurple} />
          <SplitChip label="Savings" pct={budgetSplit.savings} cashVal={fmt(savingsCash, symbol)} color={C.brass} />
        </div>
        {committedNeedsPeriod > 0 && (
          <div className="text-[11px] p-2.5 rounded-lg mb-2" style={{ background: C.paperDark, color: C.inkSoft }}>
            💡 <strong>{fmt(committedNeedsPeriod, symbol)}</strong> in fixed expenses auto-deducted from Needs. Available flex Needs cash: <strong>{fmt(flexNeedsCash, symbol)}</strong>.
          </div>
        )}
      </Card>

      {/* Target Items List */}
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-sm font-bold uppercase tracking-wide" style={{ color: C.slate, fontFamily: "'Public Sans', sans-serif" }}>Wishlist & Target Items</h2>
        <div className="flex items-center gap-3">
          <button onClick={() => setShowWishlist(true)} className="text-xs font-semibold" style={{ color: C.slate }}>View All ({rankedPending.length})</button>
          <button onClick={() => setShowAddItem(true)} className="text-xs font-semibold inline-flex items-center gap-1" style={{ color: C.moss }}>
            <Plus size={14} /> Add target
          </button>
        </div>
      </div>
      <div className="space-y-2 mb-6">
        {topFive.length === 0 && <EmptyRow text="No active wishlist items yet" />}
        {topFive.map((item) => (
          <TargetItemCard
            key={item.id}
            item={item}
            symbol={symbol}
            purchasable={balance >= item.cost}
            onDelete={() => onDeleteItem(item.id)}
            onComplete={() => onMarkPurchased(item)}
            onTap={() => setEditingItem(item)}
          />
        ))}
      </div>

      {purchasedTargets.length > 0 && (
        <details className="text-xs mb-4">
          <summary className="font-semibold cursor-pointer py-1" style={{ color: C.slate }}>
            Purchased targets history ({purchasedTargets.length})
          </summary>
          <div className="space-y-2 mt-2">
            {purchasedTargets.map((it) => (
              <RowItem
                key={it.id}
                tone={C.moss}
                title={it.name}
                subtitle={`Purchased ${it.purchasedDate || ""} · ${fmt(it.cost, symbol)}`}
                onDelete={() => onDeletePurchase(it)}
                right={
                  <button
                    onClick={() => onUndoPurchase(it)}
                    className="text-[11px] font-semibold px-2 py-1 rounded-full whitespace-nowrap"
                    style={{ background: C.brassBg, color: C.brass, fontFamily: "'Public Sans', sans-serif" }}
                  >
                    Undo
                  </button>
                }
              />
            ))}
          </div>
        </details>
      )}

      {showAddItem && <ItemModal onClose={() => setShowAddItem(false)} onSave={onAddItem} forceTarget />}
      {editingItem && (
        <EditDateModal
          item={editingItem}
          onClose={() => setEditingItem(null)}
          onSave={(date) => onEditDate(editingItem.id, date)}
        />
      )}
      {showWishlist && (
        <WishlistModal items={items} symbol={symbol} balance={balance} onClose={() => setShowWishlist(false)}
          onDelete={onDeleteItem} onComplete={onMarkPurchased} onTap={(item) => setEditingItem(item)} />
      )}
      {showEditPlan && (
        <EditPlanModal
          profile={profile} budgetSplit={budgetSplit} suggestedSplit={suggestedSplit} expenses={expenses} logs={logs} symbol={symbol}
          onClose={() => setShowEditPlan(false)} onSaveSplit={onSaveSplit} onChangeCheckInDay={onChangeCheckInDay}
        />
      )}
    </div>
  );
}

function ProfilePage({ state, symbol, onUpdateProfile, onAddItem, onDeleteItem, onAddExpense, onDeleteExpense, onReset, onToggleNotif, onOpenAllowanceModal, onGoogleSignInSuccess, onGoogleSignOut, onChangeFrequency }) {
  const { profile, items, expenses, logs } = state;
  const [showExpenseModal, setShowExpenseModal] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const googleBtnRef = React.useRef(null);

  useEffect(() => {
    if (profile.isGoogleConnected) return;
    let cancelled = false;
    function trySetup() {
      if (cancelled) return;
      if (typeof window !== "undefined" && window.google && window.google.accounts && window.google.accounts.id) {
        window.google.accounts.id.initialize({ client_id: GOOGLE_CLIENT_ID, callback: onGoogleSignInSuccess });
        if (googleBtnRef.current) {
          window.google.accounts.id.renderButton(googleBtnRef.current, { theme: "outline", size: "medium", width: 260 });
        }
      } else {
        setTimeout(trySetup, 300);
      }
    }
    trySetup();
    return () => { cancelled = true; };
  }, [profile.isGoogleConnected, onGoogleSignInSuccess]);
  const [name, setName] = useState(profile.name);

  const isNotifEnabled = profile.remindersEnabled ?? true;
  const balance = computeBalance(profile, logs);
  const tier = profile.tier === "premium" ? "Premium" : "Free";

  return (
    <div className="max-w-md lg:max-w-2xl mx-auto px-5 pt-8 pb-28">
      <div className="text-xs font-bold tracking-widest uppercase mb-1" style={{ color: C.brass, fontFamily: "'Public Sans', sans-serif" }}>Account Profile</div>
      <h1 className="text-2xl mb-5" style={{ fontFamily: "'Fraunces', serif", color: C.ink, fontWeight: 600 }}>Preferences & Setup</h1>

      <Card className="mb-4 grid grid-cols-3 gap-2">
        <Stat label="Member since" value={profile.memberSince} />
        <Stat label="Tier" value={tier} tone={profile.tier === "premium" ? C.brass : undefined} />
        <Stat label="Balance" value={fmt(balance, symbol)} tone={balance < 0 ? C.danger : C.moss} />
      </Card>

      <Card className="mb-4">
        <div className="text-sm font-bold uppercase tracking-wide mb-3" style={{ color: C.slate, fontFamily: "'Public Sans', sans-serif" }}>Account Preferences</div>
        <Field label="Name">
          <TextInput value={name} onChange={(e) => setName(e.target.value)} onBlur={() => onUpdateProfile({ name: name.trim() || profile.name })} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Currency">
            <Select value={profile.currency} onChange={(e) => onUpdateProfile({ currency: e.target.value })} options={CURRENCIES.map((c) => ({ value: c.code, label: `${c.code} (${c.symbol})` }))} />
          </Field>
          <Field label="Frequency">
            <Select value={profile.frequency} onChange={(e) => onChangeFrequency(e.target.value)} options={FREQUENCIES.map((f) => ({ value: f, label: f }))} />
          </Field>
        </div>
        <Field label="Membership tier">
          <PillToggle options={[{ value: "free", label: "Free" }, { value: "premium", label: "Premium" }]}
            value={profile.tier || "free"} onChange={(v) => onUpdateProfile({ tier: v })} />
        </Field>
        <button
          onClick={onOpenAllowanceModal}
          className="w-full flex items-center justify-between px-3.5 py-2.5 rounded-lg border text-sm font-medium mb-2.5"
          style={{ borderColor: C.line, color: C.ink, fontFamily: "'Public Sans', sans-serif" }}
        >
          <span className="flex items-center gap-2"><Wallet size={15} color={C.brass} /> Allowance Base</span>
          <span className="text-xs font-bold" style={{ color: C.brass, fontFamily: "'IBM Plex Mono', monospace" }}>
            {fmt(profile.allowance, symbol)} · Update
          </span>
        </button>
        <button
          onClick={onToggleNotif}
          className="w-full flex items-center justify-between px-3.5 py-2.5 rounded-lg border text-sm font-medium transition-colors"
          style={{ borderColor: C.line, color: C.ink, fontFamily: "'Public Sans', sans-serif" }}
        >
          <span className="flex items-center gap-2">
            {isNotifEnabled ? <Bell size={15} color={C.moss} /> : <BellOff size={15} color={C.slate} />}
            Check-in reminders
          </span>
          <span
            className="text-xs font-bold px-2.5 py-1 rounded-full"
            style={{
              background: isNotifEnabled ? C.mossBg : C.paperDark,
              color: isNotifEnabled ? C.moss : C.slate
            }}
          >
            {isNotifEnabled ? "Enabled" : "Disabled"}
          </span>
        </button>
      </Card>

      <Card className="mb-4">
        <div className="flex items-center justify-between mb-3">
          <div className="text-sm font-bold uppercase tracking-wide" style={{ color: C.slate, fontFamily: "'Public Sans', sans-serif" }}>Recurring Expenses ({expenses.length})</div>
          <button onClick={() => setShowExpenseModal(true)} className="text-xs font-semibold" style={{ color: C.moss }}>+ Add</button>
        </div>
        <div className="space-y-2">
          {expenses.length === 0 && <EmptyRow text="No recurring expenses added" />}
          {expenses.map((ex) => (
            <RowItem key={ex.id} tone={ex.type === "fixed" ? C.brass : C.slate} title={ex.name}
              subtitle={`${ex.type} ${ex.category} · ${fmt(ex.amount, symbol)} / ${ex.freq}`}
              onDelete={() => onDeleteExpense(ex.id)} />
          ))}
        </div>
      </Card>

      <Card className="mb-6">
        <div className="text-sm font-bold uppercase tracking-wide mb-3" style={{ color: C.slate }}>Sync & Data</div>
        {profile.isGoogleConnected ? (
          <div className="w-full flex items-center justify-between px-3.5 py-2.5 rounded-lg border text-sm font-medium mb-1.5" style={{ borderColor: C.line, color: C.ink }}>
            <span className="flex items-center gap-2 truncate">
              <ShieldCheck size={16} color={C.moss} />
              <span className="truncate">{profile.email || "Google account"}</span>
            </span>
            <button onClick={onGoogleSignOut} className="text-xs font-semibold shrink-0" style={{ color: C.danger }}>Sign out</button>
          </div>
        ) : (
          <div ref={googleBtnRef} className="mb-1.5" />
        )}
        <p className="text-[11px] mb-3" style={{ color: C.slate, fontFamily: "'Public Sans', sans-serif" }}>
          Sign-in identifies you locally via Google — set GOOGLE_CLIENT_ID in App.jsx to your own OAuth client ID first. Your data itself lives in this device's local storage; sign-in doesn't sync it anywhere by itself yet.
        </p>
        <Btn variant="danger" className="w-full" onClick={() => setShowResetConfirm(true)}>Reset All Data</Btn>
      </Card>

      {showExpenseModal && <ExpenseModal onClose={() => setShowExpenseModal(false)} onSave={onAddExpense} />}
      {showResetConfirm && <ResetConfirmModal onClose={() => setShowResetConfirm(false)} onConfirm={onReset} />}
    </div>
  );
}

export default function App() {
  const [loaded, setLoaded] = useState(false);
  const [profile, setProfile] = useState(null);
  const [items, setItems] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [logs, setLogs] = useState([]);
  const [budgetSplit, setBudgetSplit] = useState({ needs: 50, wants: 30, savings: 20 });
  const [suggestedSplit, setSuggestedSplit] = useState({ needs: 50, wants: 30, savings: 20 });
  const [view, setView] = useState("dashboard");
  const [showLogModal, setShowLogModal] = useState(false);
  const [showAllowanceModal, setShowAllowanceModal] = useState(false);
  const [showMacroCheckInModal, setShowMacroCheckInModal] = useState(false);
  const [showAllowanceReminderModal, setShowAllowanceReminderModal] = useState(false);
  const [notifStatus, setNotifStatus] = useState(typeof Notification !== "undefined" ? Notification.permission : "unsupported");

  useEffect(() => {
    (async () => {
      try {
        const res = await storageHelper.get(STORAGE_KEY);
        if (res && res.value) {
          const d = JSON.parse(res.value);
          let p = d.profile || null;
          if (p) {
            const today = todayISO();
            const patched = {
              totalReceived: p.totalReceived ?? p.allowance ?? 0,
              checkInDay: p.checkInDay ?? 1,
              nextCheckInDate: p.nextCheckInDate ?? nextWeekday(today, p.checkInDay ?? 1),
              tier: p.tier || "free",
              isGoogleConnected: p.isGoogleConnected || false,
              remindersEnabled: p.remindersEnabled ?? true,
              savingsPool: p.savingsPool ?? 0,
              wantsPool: p.wantsPool ?? 0,
              allowanceReminderSnoozed: p.allowanceReminderSnoozed ?? false,
              nextAllowanceReminderDate: p.nextAllowanceReminderDate
                ?? computeNextAllowanceReminderDate(p.lastAllowanceUpdate || today, p.frequency),
            };
            p = { ...p, ...patched };
          }
          setProfile(p);
          setItems(d.items || []);
          setExpenses(d.expenses || [
            { id: uid(), type: "fixed", category: "needs", name: "TNG Card / Transit", amount: 50, freq: "month" }
          ]);
          setLogs(d.logs || []);
          setBudgetSplit(d.budgetSplit || { needs: 50, wants: 30, savings: 20 });
          setSuggestedSplit(d.suggestedSplit || { needs: 50, wants: 30, savings: 20 });
        }
      } catch (e) {
        console.error("Storage load error:", e);
      }
      setLoaded(true);
    })();
  }, []);

  const persist = useCallback(async (patch) => {
    try {
      const current = { profile, items, expenses, logs, budgetSplit, suggestedSplit, ...patch };
      await storageHelper.set(STORAGE_KEY, JSON.stringify(current));
    } catch (e) {
      console.error("Persist error:", e);
    }
  }, [profile, items, expenses, logs, budgetSplit, suggestedSplit]);

  const handleOnboardingComplete = (data) => {
    setProfile(data.profile);
    setItems(data.items);
    setExpenses(data.expenses);
    setBudgetSplit(data.budgetSplit);
    setSuggestedSplit(data.suggestedSplit);
    persist(data);
  };

  async function toggleNotif() {
    const currentState = profile?.remindersEnabled ?? true;
    const nextState = !currentState;

    if (nextState && typeof Notification !== "undefined" && Notification.permission !== "granted") {
      try {
        const perm = await Notification.requestPermission();
        setNotifStatus(perm);
      } catch (e) {
        console.warn("Notification permission request unavailable or blocked:", e);
      }
    }

    updateProfile({ remindersEnabled: nextState });
  }

  function addLog(log) { const next = [...logs, log]; setLogs(next); persist({ logs: next }); }
  function updateLog(updated) { const next = logs.map((l) => (l.id === updated.id ? updated : l)); setLogs(next); persist({ logs: next }); }
  function deleteLog(id) { const next = logs.filter((l) => l.id !== id); setLogs(next); persist({ logs: next }); }
  function addItem(item) { const next = [...items, item]; setItems(next); persist({ items: next }); }
  function deleteItem(id) { const next = items.filter((i) => i.id !== id); setItems(next); persist({ items: next }); }
  function updateItemDate(id, date) {
    const next = items.map((i) => (i.id === id ? { ...i, targetDate: date } : i));
    setItems(next); persist({ items: next });
  }
  function markPurchased(item) {
    const logId = uid();
    const nextItems = items.map((i) => (i.id === item.id ? { ...i, purchased: true, purchasedDate: todayISO(), purchaseLogId: logId } : i));
    const nextLogs = [...logs, {
      id: logId, type: "expense", category: item.type === "need" ? "needs" : "wants",
      amount: item.cost, note: item.name, date: todayISO(),
    }];
    setItems(nextItems); setLogs(nextLogs);
    persist({ items: nextItems, logs: nextLogs });
  }
  function undoPurchase(item) {
    const nextItems = items.map((i) => (i.id === item.id ? { ...i, purchased: false, purchasedDate: null, purchaseLogId: null } : i));
    const nextLogs = item.purchaseLogId ? logs.filter((l) => l.id !== item.purchaseLogId) : logs;
    setItems(nextItems); setLogs(nextLogs);
    persist({ items: nextItems, logs: nextLogs });
  }
  function deletePurchase(item) {
    const nextItems = items.filter((i) => i.id !== item.id);
    const nextLogs = item.purchaseLogId ? logs.filter((l) => l.id !== item.purchaseLogId) : logs;
    setItems(nextItems); setLogs(nextLogs);
    persist({ items: nextItems, logs: nextLogs });
  }
  function addExpense(ex) { const next = [...expenses, ex]; setExpenses(next); persist({ expenses: next }); }
  function deleteExpense(id) { const next = expenses.filter((e) => e.id !== id); setExpenses(next); persist({ expenses: next }); }
  function updateProfile(patch) { const next = { ...profile, ...patch }; setProfile(next); persist({ profile: next }); }
  function saveSplit(split) { setBudgetSplit(split); persist({ budgetSplit: split }); }
  function applyRecommendedSplit({ split, dailyCap }) {
    const needsWantsTotal = split.needs + split.wants;
    const needsPct = needsWantsTotal > 0 ? split.needs / needsWantsTotal : 0.5;
    const wantsPct = needsWantsTotal > 0 ? split.wants / needsWantsTotal : 0.5;
    const dailyNeedsCap = dailyCap * needsPct;
    const dailyWantsCap = dailyCap * wantsPct;
    setBudgetSplit(split);
    setProfile((prev) => {
      const next = {
        ...prev,
        nextCheckInDate: addDays(prev.nextCheckInDate || todayISO(), 7),
        dailyCapOverride: dailyCap,
        dailyNeedsCap,
        dailyWantsCap,
      };
      persist({ budgetSplit: split, profile: next });
      return next;
    });
    setShowMacroCheckInModal(false);
  }

  function changeCheckInDay(day) {
    const next = { ...profile, checkInDay: day, nextCheckInDate: nextWeekday(todayISO(), day) };
    setProfile(next); persist({ profile: next });
  }
  function skipCheckIn() {
    const next = { ...profile, nextCheckInDate: addDays(profile.nextCheckInDate || todayISO(), 7) };
    setProfile(next); persist({ profile: next });
  }
  function submitAllowance({ amount, currency }) {
    const next = {
      ...profile, allowance: amount, currency,
      lastAllowanceUpdate: todayISO(),
      totalReceived: (Number(profile.totalReceived) || 0) + amount,
      dailyCapOverride: null,
      dailyNeedsCap: null,
      dailyWantsCap: null,
      nextAllowanceReminderDate: computeNextAllowanceReminderDate(todayISO(), profile.frequency),
      allowanceReminderSnoozed: false,
    };
    setProfile(next); persist({ profile: next });
  }

  function snoozeAllowanceReminder(newDate) {
    const next = { ...profile, nextAllowanceReminderDate: newDate, allowanceReminderSnoozed: true };
    setProfile(next); persist({ profile: next });
  }

  function handleReminderSetAmount(amount) {
    submitAllowance({ amount, currency: profile.currency });
    setShowAllowanceReminderModal(false);
  }
  function handleReminderLeaveSame() {
    submitAllowance({ amount: Number(profile.allowance) || 0, currency: profile.currency });
    setShowAllowanceReminderModal(false);
  }
  function handleReminderSnooze({ fromIso, days, explicitDate }) {
    snoozeAllowanceReminder(computeSnoozeDate({ fromIso, days, explicitDate }));
    setShowAllowanceReminderModal(false);
  }

  function changeFrequency(freq) {
    const next = {
      ...profile,
      frequency: freq,
      nextAllowanceReminderDate: computeNextAllowanceReminderDate(profile.lastAllowanceUpdate || todayISO(), freq),
    };
    setProfile(next); persist({ profile: next });
  }

  function handleGoogleSignInSuccess(response) {
    const payload = response && decodeGoogleJwt(response.credential);
    if (!payload) return;
    updateProfile({ isGoogleConnected: true, email: payload.email, googleName: payload.name || null });
  }
  function handleGoogleSignOut() {
    try { if (typeof window !== "undefined" && window.google) window.google.accounts.id.disableAutoSelect(); } catch (e) {}
    updateProfile({ isGoogleConnected: false, email: null, googleName: null });
  }

  async function resetAll() {
    setProfile(null); setItems([]); setExpenses([]); setLogs([]);
    setBudgetSplit({ needs: 50, wants: 30, savings: 20 }); setSuggestedSplit({ needs: 50, wants: 30, savings: 20 });
    try { await storageHelper.set(STORAGE_KEY, JSON.stringify({})); } catch (e) {}
    setView("dashboard");
  }

  if (!loaded) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: C.paper }}>
        <style>{FONT_IMPORT}</style>
        <Loader2 className="animate-spin" size={22} color={C.ink} />
      </div>
    );
  }

  if (!profile) {
    return (
      <div style={{ fontFamily: "'Public Sans', sans-serif" }}>
        <style>{FONT_IMPORT}</style>
        <Onboarding onComplete={handleOnboardingComplete} />
      </div>
    );
  }

  const symbol = symbolFor(profile.currency);
  const state = { profile, items, expenses, logs, budgetSplit, suggestedSplit };
  const checkInDue = profile.nextCheckInDate ? todayISO() >= profile.nextCheckInDate : true;
  const daysToCheckIn = profile.nextCheckInDate ? Math.max(0, daysBetween(todayISO(), profile.nextCheckInDate)) : 0;

  return (
    <div className="min-h-screen relative" style={{ background: C.paper, fontFamily: "'Public Sans', sans-serif" }}>
      <style>{FONT_IMPORT}</style>

      {view === "dashboard" && (
        <Dashboard
          state={state} symbol={symbol} dueSoon={checkInDue}
          onOpenLog={() => setShowLogModal(true)}
          onCheckIn={() => setShowMacroCheckInModal(true)}
          setView={setView}
        />
      )}

      {view === "diary" && <Diary logs={logs} symbol={symbol} onUpdateLog={updateLog} onDeleteLog={deleteLog} />}

      {view === "strategy" && (
        <Strategy
          state={state} symbol={symbol} checkInDue={checkInDue} daysToCheckIn={daysToCheckIn}
          onCheckIn={() => setShowMacroCheckInModal(true)}
          onSkipCheckIn={skipCheckIn}
          onChangeCheckInDay={changeCheckInDay}
          onAddItem={addItem}
          onDeleteItem={deleteItem}
          onEditDate={updateItemDate}
          onMarkPurchased={markPurchased}
          onUndoPurchase={undoPurchase}
          onDeletePurchase={deletePurchase}
          onSaveSplit={saveSplit}
        />
      )}

      {view === "profile" && (
        <ProfilePage
          state={state} symbol={symbol} onUpdateProfile={updateProfile} onAddItem={addItem} onDeleteItem={deleteItem}
          onAddExpense={addExpense} onDeleteExpense={deleteExpense} onReset={resetAll} onToggleNotif={toggleNotif}
          onOpenAllowanceModal={() => setShowAllowanceModal(true)}
          onGoogleSignInSuccess={handleGoogleSignInSuccess} onGoogleSignOut={handleGoogleSignOut}
          onChangeFrequency={changeFrequency}
        />
      )}

      <NavBar view={view} setView={setView} />

      {showLogModal && <LogModal currencySymbol={symbol} onClose={() => setShowLogModal(false)} onSave={addLog} />}
      {showAllowanceModal && <AllowanceModal profile={profile} onClose={() => setShowAllowanceModal(false)} onSave={submitAllowance} />}
      {showAllowanceReminderModal && (
        <AllowanceReminderModal
          profile={profile} symbol={symbol}
          onClose={() => setShowAllowanceReminderModal(false)}
          onSetAmount={handleReminderSetAmount}
          onLeaveSame={handleReminderLeaveSame}
          onSnooze={handleReminderSnooze}
        />
      )}
      {showMacroCheckInModal && (
        <MacroCheckInModal
          profile={profile} logs={logs} budgetSplit={budgetSplit} expenses={expenses} symbol={symbol}
          onClose={() => setShowMacroCheckInModal(false)}
          onApplyRecommendation={applyRecommendedSplit}
        />
      )}
    </div>
  );
}
