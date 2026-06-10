import { useEffect, useMemo, useState } from "react";
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  type User,
} from "firebase/auth";
import { FirebaseError } from "firebase/app";
import { auth } from "./lib/firebase";
import { isAdminUser } from "./lib/admin";
import {
  createReservation,
  deleteReservation,
  ReservationConflictError,
  ReservationUnavailableDateError,
  subscribeReservations,
  type Reservation,
} from "./lib/reservations";
import {
  formatReservationPeriod,
  formatCompactReservationPeriod,
  isDateWithinPeriod,
  ReservationPeriodError,
  subscribeReservationPeriod,
  updateReservationPeriod,
  type ReservationPeriod,
} from "./lib/settings";
import {
  formatDateId,
  formatReservationUsagePeriod,
  formatReservationWindow,
  getMonthCells,
  getMonthTitle,
  getTodayId,
  getWeekendReservationFridayDateId,
  getWeekendReservationGroupRole,
  isReservableDateId,
  shiftMonth,
} from "./lib/dates";

type Toast = {
  id: number;
  tone: "success" | "error" | "info";
  title: string;
  description?: string;
};

type ReservationForm = {
  employeeId: string;
  department: string;
  name: string;
};

const vehicleImage = "/model-x.png";
const EMPLOYEE_ID_PREFIX = "monster";
const EMPLOYEE_ID_SUFFIX_MAX_LENGTH = 23;
const ADMIN_PAGE_SIZE = 10;

type AdminReservationFilter = "all" | "upcoming" | "past";

const weekdays = ["일", "월", "화", "수", "목", "금", "토"];

function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const pushToast = (toast: Omit<Toast, "id">) => {
    const id = Date.now() + Math.random();
    setToasts((current) => [...current, { ...toast, id }]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((item) => item.id !== id));
    }, 4200);
  };

  const removeToast = (id: number) => {
    setToasts((current) => current.filter((item) => item.id !== id));
  };

  return { toasts, pushToast, removeToast };
}

function ToastStack({
  toasts,
  onRemove,
}: {
  toasts: Toast[];
  onRemove: (id: number) => void;
}) {
  return (
    <div className="toast-stack" role="status" aria-live="polite">
      {toasts.map((toast) => (
        <button
          className={`toast toast-${toast.tone}`}
          key={toast.id}
          onClick={() => onRemove(toast.id)}
          type="button"
        >
          <strong>{toast.title}</strong>
          {toast.description ? <span>{toast.description}</span> : null}
        </button>
      ))}
    </div>
  );
}

function App() {
  const [path, setPath] = useState(window.location.pathname);

  useEffect(() => {
    const onPopState = () => setPath(window.location.pathname);
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  if (path === "/admin") {
    return <AdminPage />;
  }

  return <ReservationPage />;
}

function ReservationPage() {
  const { toasts, pushToast, removeToast } = useToasts();
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [reservationPeriod, setReservationPeriod] = useState<ReservationPeriod | null>(null);
  const [periodLoading, setPeriodLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState("");
  const [month, setMonth] = useState(() => new Date());
  const [submitting, setSubmitting] = useState(false);
  const [isRequestModalOpen, setIsRequestModalOpen] = useState(false);
  const [form, setForm] = useState<ReservationForm>({
    employeeId: "",
    department: "",
    name: "",
  });

  useEffect(() => {
    const unsubscribe = subscribeReservations(
      (nextReservations) => {
        setReservations(nextReservations);
      },
      () => {
        pushToast({
          tone: "error",
          title: "예약 상태를 불러오지 못했습니다.",
          description: "Firestore 읽기 권한과 네트워크 상태를 확인하세요.",
        });
      },
    );

    return unsubscribe;
  }, []);

  useEffect(() => {
    const unsubscribe = subscribeReservationPeriod(
      (period) => {
        setReservationPeriod(period);
        setPeriodLoading(false);
      },
      () => {
        setPeriodLoading(false);
        pushToast({
          tone: "error",
          title: "예약 기간 정보를 불러오지 못했습니다.",
        });
      },
    );

    return unsubscribe;
  }, []);

  useEffect(() => {
    if (
      selectedDate &&
      (!isReservableDateId(selectedDate) ||
        (reservationPeriod && !isDateWithinPeriod(selectedDate, reservationPeriod)))
    ) {
      setSelectedDate("");
    }
  }, [reservationPeriod, selectedDate]);

  useEffect(() => {
    if (!selectedDate) {
      setIsRequestModalOpen(false);
    }
  }, [selectedDate]);

  useEffect(() => {
    if (!isRequestModalOpen) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsRequestModalOpen(false);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isRequestModalOpen]);

  const reservationByDate = useMemo(() => {
    const map = new Map<string, Reservation>();

    for (const reservation of reservations) {
      map.set(reservation.date, reservation);
    }

    return map;
  }, [reservations]);
  const todayId = getTodayId();
  const monthCells = getMonthCells(month);
  const isSelectedDateReserved = selectedDate ? reservationByDate.has(selectedDate) : false;
  const isSelectedDateAllowed = selectedDate
    ? isDateWithinPeriod(selectedDate, reservationPeriod)
    : false;
  const hasEmployeeIdSuffix =
    form.employeeId.startsWith(EMPLOYEE_ID_PREFIX) &&
    form.employeeId.trim().length > EMPLOYEE_ID_PREFIX.length;
  const canSubmit = Boolean(
    selectedDate &&
      isReservableDateId(selectedDate) &&
      isSelectedDateAllowed &&
      !isSelectedDateReserved &&
      hasEmployeeIdSuffix &&
      form.department.trim() &&
      form.name.trim() &&
      !submitting &&
      !periodLoading,
  );

  const updateForm = (field: keyof ReservationForm, value: string) => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  const updateEmployeeId = (value: string) => {
    if (!value) {
      updateForm("employeeId", "");
      return;
    }

    let suffix = "";

    if (value.startsWith(EMPLOYEE_ID_PREFIX)) {
      suffix = value.slice(EMPLOYEE_ID_PREFIX.length);
    } else if (value.length < EMPLOYEE_ID_PREFIX.length && EMPLOYEE_ID_PREFIX.startsWith(value)) {
      suffix = "";
    } else {
      suffix = value.slice(EMPLOYEE_ID_PREFIX.length);
    }

    updateForm(
      "employeeId",
      EMPLOYEE_ID_PREFIX + suffix.slice(0, EMPLOYEE_ID_SUFFIX_MAX_LENGTH),
    );
  };

  const clampEmployeeIdSelection = (input: HTMLInputElement) => {
    if (!input.value.startsWith(EMPLOYEE_ID_PREFIX)) {
      return;
    }

    const prefixLength = EMPLOYEE_ID_PREFIX.length;
    const selectionStart = input.selectionStart ?? 0;
    const selectionEnd = input.selectionEnd ?? 0;

    if (selectionStart < prefixLength || selectionEnd < prefixLength) {
      input.setSelectionRange(
        Math.max(selectionStart, prefixLength),
        Math.max(selectionEnd, prefixLength),
      );
    }
  };

  const handleEmployeeIdChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    updateEmployeeId(event.target.value);
    requestAnimationFrame(() => {
      clampEmployeeIdSelection(event.target);
    });
  };

  const handleEmployeeIdKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (!form.employeeId.startsWith(EMPLOYEE_ID_PREFIX)) {
      return;
    }

    const input = event.currentTarget;
    const prefixLength = EMPLOYEE_ID_PREFIX.length;
    const selectionStart = input.selectionStart ?? 0;
    const selectionEnd = input.selectionEnd ?? 0;

    if (event.key !== "Backspace" && event.key !== "Delete") {
      return;
    }

    if (selectionStart <= prefixLength && selectionEnd <= prefixLength) {
      event.preventDefault();
      input.setSelectionRange(prefixLength, prefixLength);
    }
  };

  const handleEmployeeIdFocus = (event: React.FocusEvent<HTMLInputElement>) => {
    if (form.employeeId) {
      requestAnimationFrame(() => {
        clampEmployeeIdSelection(event.target);
      });
      return;
    }

    updateForm("employeeId", EMPLOYEE_ID_PREFIX);
    requestAnimationFrame(() => {
      event.target.setSelectionRange(EMPLOYEE_ID_PREFIX.length, EMPLOYEE_ID_PREFIX.length);
    });
  };

  const handleEmployeeIdSelect = (event: React.SyntheticEvent<HTMLInputElement>) => {
    clampEmployeeIdSelection(event.currentTarget);
  };

  const handleEmployeeIdBlur = () => {
    if (!form.employeeId || form.employeeId.length <= EMPLOYEE_ID_PREFIX.length) {
      updateForm("employeeId", "");
    }
  };

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!selectedDate) {
      pushToast({ tone: "error", title: "예약 날짜를 선택하세요." });
      return;
    }

    if (!hasEmployeeIdSuffix || !form.department.trim() || !form.name.trim()) {
      pushToast({ tone: "error", title: "사번, 부서, 이름을 모두 입력하세요." });
      return;
    }

    if (reservationByDate.has(selectedDate)) {
      pushToast({ tone: "error", title: "이미 예약됐습니다." });
      return;
    }

    if (!isReservableDateId(selectedDate)) {
      pushToast({
        tone: "error",
        title: "토요일과 일요일은 금요일 예약에 포함됩니다.",
        description: "금요일 날짜를 선택하세요.",
      });
      return;
    }

    if (reservationPeriod && !isDateWithinPeriod(selectedDate, reservationPeriod)) {
      pushToast({
        tone: "error",
        title: "예약 가능 기간이 아닙니다.",
        description: formatReservationPeriod(reservationPeriod),
      });
      return;
    }

    setSubmitting(true);

    try {
      await createReservation({
        date: selectedDate,
        employeeId: form.employeeId.trim(),
        department: form.department,
        name: form.name,
      });

      pushToast({
        tone: "success",
        title: "예약이 완료됐습니다.",
        description: `${formatDateId(selectedDate)} ${formatReservationWindow(selectedDate)}`,
      });
      setForm({ employeeId: "", department: "", name: "" });
      setSelectedDate("");
      setIsRequestModalOpen(false);
    } catch (error) {
      if (error instanceof ReservationConflictError) {
        pushToast({ tone: "error", title: "이미 예약됐습니다." });
      } else if (error instanceof ReservationUnavailableDateError) {
        pushToast({
          tone: "error",
          title: "토요일과 일요일은 금요일 예약에 포함됩니다.",
          description: "금요일 날짜를 선택하세요.",
        });
      } else if (error instanceof ReservationPeriodError) {
        pushToast({
          tone: "error",
          title: "예약 가능 기간이 아닙니다.",
          description: reservationPeriod ? formatReservationPeriod(reservationPeriod) : undefined,
        });
      } else {
        pushToast({
          tone: "error",
          title: "예약에 실패했습니다.",
          description: error instanceof Error ? error.message : "잠시 후 다시 시도하세요.",
        });
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="app-shell">
      <ToastStack toasts={toasts} onRemove={removeToast} />

      <header className="top-section">
        <div className="vehicle-thumb" aria-hidden="true">
          <img src={vehicleImage} alt="" />
        </div>
        <div className="top-copy">
          <p className="eyebrow">INTERNAL RESERVATION</p>
          <h1>Tesla Model X 예약</h1>
        </div>
      </header>

      <main className="reservation-dashboard">
        <section className="panel calendar-panel" aria-label="예약 날짜 선택">
          <div className="panel-heading">
            <div>
              <p className="section-kicker">DATE</p>
              <h2>예약 가능 날짜</h2>
            </div>
            <div className="month-controls">
              <button
                aria-label="이전 달"
                className="icon-button"
                onClick={() => setMonth((current) => shiftMonth(current, -1))}
                type="button"
              >
                ‹
              </button>
              <strong>{getMonthTitle(month)}</strong>
              <button
                aria-label="다음 달"
                className="icon-button"
                onClick={() => setMonth((current) => shiftMonth(current, 1))}
                type="button"
              >
                ›
              </button>
            </div>
          </div>

          <div className="calendar-weekdays">
            {weekdays.map((weekday) => (
              <span key={weekday}>{weekday}</span>
            ))}
          </div>

          <div className="calendar-grid">
            {monthCells.map((cell) => {
              const groupRole = getWeekendReservationGroupRole(cell.dateId);
              const isWeekendStart = groupRole === "start";
              const isWeekendGroup = groupRole !== null;
              const linkedFridayDateId = getWeekendReservationFridayDateId(cell.dateId) ?? cell.dateId;
              const reservation = reservationByDate.get(linkedFridayDateId);
              const isReserved = Boolean(reservation);
              const isPast = linkedFridayDateId < todayId;
              const isOutsidePeriod =
                Boolean(reservationPeriod) &&
                !isDateWithinPeriod(linkedFridayDateId, reservationPeriod);
              const isDisabled =
                !cell.isCurrentMonth || isReserved || isPast || isOutsidePeriod;
              const isSelected = isWeekendGroup
                ? selectedDate === linkedFridayDateId
                : selectedDate === cell.dateId;
              const statusLabel = isPast
                ? "종료"
                : isOutsidePeriod
                  ? "기간외"
                  : isWeekendStart
                    ? "금"
                    : groupRole === "middle"
                      ? "토"
                      : groupRole === "end"
                        ? "일"
                        : "가능";
              const availabilityLabel = isReserved
                ? `${reservation?.department} ${reservation?.name} 예약됨`
                : isOutsidePeriod
                  ? "예약 불가"
                  : isWeekendGroup
                    ? "금토일 예약 가능"
                    : "예약 가능";

              return (
                <button
                  aria-disabled={isDisabled}
                  aria-label={`${cell.dateId} ${availabilityLabel}`}
                  className={[
                    "calendar-day",
                    !cell.isCurrentMonth ? "calendar-day-muted" : "",
                    isReserved ? "calendar-day-reserved" : "",
                    isPast && cell.isCurrentMonth ? "calendar-day-past" : "",
                    isOutsidePeriod && cell.isCurrentMonth ? "calendar-day-outside" : "",
                    groupRole === "start" && cell.isCurrentMonth
                      ? "calendar-day-weekend-group-start"
                      : "",
                    groupRole === "middle" && cell.isCurrentMonth
                      ? "calendar-day-weekend-group-middle"
                      : "",
                    groupRole === "end" && cell.isCurrentMonth
                      ? "calendar-day-weekend-group-end"
                      : "",
                    isSelected ? "calendar-day-selected" : "",
                  ].join(" ")}
                  disabled={isDisabled}
                  key={cell.dateId}
                  onClick={() => {
                    setSelectedDate(linkedFridayDateId);
                    setIsRequestModalOpen(true);
                  }}
                  title={
                    isReserved && reservation
                      ? `${reservation.department} · ${reservation.name}`
                      : undefined
                  }
                  type="button"
                >
                  <span>{cell.day}</span>
                  {cell.isCurrentMonth ? (
                    isReserved && reservation ? (
                      <div className="calendar-day-reservation">
                        <small>{reservation.department}</small>
                        <small>{reservation.name}</small>
                      </div>
                    ) : (
                      <small>{statusLabel}</small>
                    )
                  ) : null}
                </button>
              );
            })}
          </div>

          <div className="calendar-legend" aria-label="예약 상태">
            <span>
              <i className="legend-dot legend-open" /> 가능
            </span>
            <span>
              <i className="legend-dot legend-reserved" /> 예약됨
            </span>
            <span>
              <i className="legend-dot legend-selected" /> 선택
            </span>
            <span>
              <i className="legend-dot legend-weekend" /> 금토일
            </span>
            {reservationPeriod ? (
              <span>
                <i className="legend-dot legend-outside" /> 기간 외
              </span>
            ) : null}
          </div>
        </section>
      </main>

      {isRequestModalOpen ? (
        <div
          className="modal-backdrop"
          onClick={() => setIsRequestModalOpen(false)}
          role="presentation"
        >
          <section
            aria-labelledby="request-modal-title"
            aria-modal="true"
            className="request-modal"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
          >
            <div className="modal-heading">
              <div>
                <p className="section-kicker">REQUEST</p>
                <h2 id="request-modal-title">예약 신청</h2>
              </div>
              <button
                aria-label="예약 신청 닫기"
                className="icon-button modal-close"
                onClick={() => setIsRequestModalOpen(false)}
                type="button"
              >
                ×
              </button>
            </div>

            <div className="modal-date-summary">
              <span>{selectedDate ? formatDateId(selectedDate) : "날짜 미선택"}</span>
              <strong>{selectedDate ? formatReservationWindow(selectedDate) : "-"}</strong>
            </div>

            <form className="reservation-form" onSubmit={onSubmit}>
              <label>
                사번
                <input
                  autoComplete="off"
                  inputMode="text"
                  maxLength={EMPLOYEE_ID_PREFIX.length + EMPLOYEE_ID_SUFFIX_MAX_LENGTH}
                  onBlur={handleEmployeeIdBlur}
                  onChange={handleEmployeeIdChange}
                  onClick={handleEmployeeIdSelect}
                  onFocus={handleEmployeeIdFocus}
                  onKeyDown={handleEmployeeIdKeyDown}
                  onSelect={handleEmployeeIdSelect}
                  placeholder="사번 입력"
                  value={form.employeeId}
                />
              </label>
              <label>
                부서
                <input
                  autoComplete="organization-title"
                  maxLength={60}
                  onChange={(event) => updateForm("department", event.target.value)}
                  placeholder="예: 구조부문 자산파트"
                  value={form.department}
                />
              </label>
              <label>
                이름
                <input
                  autoComplete="name"
                  maxLength={40}
                  onChange={(event) => updateForm("name", event.target.value)}
                  placeholder="예: 김슬라"
                  value={form.name}
                />
              </label>

              <button className="primary-button" disabled={!canSubmit} type="submit">
                {submitting ? "예약 처리 중" : "예약 신청"}
              </button>
            </form>
          </section>
        </div>
      ) : null}
    </div>
  );
}

function AdminReservationCalendar({
  reservations,
  period,
  selectedDate,
  onSelectDate,
}: {
  reservations: Reservation[];
  period: ReservationPeriod | null;
  selectedDate: string;
  onSelectDate: (dateId: string) => void;
}) {
  const [month, setMonth] = useState(() => new Date());
  const todayId = getTodayId();
  const monthCells = getMonthCells(month);

  const reservationByDate = useMemo(() => {
    const map = new Map<string, Reservation>();

    for (const reservation of reservations) {
      map.set(reservation.date, reservation);
    }

    return map;
  }, [reservations]);

  return (
    <section className="panel admin-calendar-panel" aria-label="예약 현황 달력">
      <div className="panel-heading admin-calendar-heading">
        <div>
          <p className="section-kicker">CALENDAR</p>
          <h2>예약 현황</h2>
        </div>
        <div className="month-controls admin-month-controls">
          <button
            aria-label="이전 달"
            className="icon-button"
            onClick={() => setMonth((current) => shiftMonth(current, -1))}
            type="button"
          >
            ‹
          </button>
          <strong>{getMonthTitle(month)}</strong>
          <button
            aria-label="다음 달"
            className="icon-button"
            onClick={() => setMonth((current) => shiftMonth(current, 1))}
            type="button"
          >
            ›
          </button>
        </div>
      </div>

      <div className="calendar-weekdays admin-calendar-weekdays">
        {weekdays.map((weekday) => (
          <span key={weekday}>{weekday}</span>
        ))}
      </div>

      <div className="calendar-grid admin-calendar-grid">
        {monthCells.map((cell) => {
          const groupRole = getWeekendReservationGroupRole(cell.dateId);
          const isWeekendGroup = groupRole !== null;
          const linkedFridayDateId = getWeekendReservationFridayDateId(cell.dateId) ?? cell.dateId;
          const reservation = reservationByDate.get(linkedFridayDateId);
          const isReserved = Boolean(reservation);
          const isPast = linkedFridayDateId < todayId;
          const isOutsidePeriod =
            Boolean(period) && !isDateWithinPeriod(linkedFridayDateId, period);
          const isSelected = selectedDate
            ? isWeekendGroup
              ? selectedDate === linkedFridayDateId
              : selectedDate === cell.dateId
            : false;
          const statusLabel = isPast
            ? "종료"
            : isOutsidePeriod
              ? "기간외"
              : isReserved
                ? "예약"
                : isWeekendGroup
                  ? groupRole === "start"
                    ? "금"
                    : groupRole === "middle"
                      ? "토"
                      : "일"
                  : "가능";

          return (
            <button
              aria-label={
                isReserved && reservation
                  ? `${cell.dateId} ${reservation.name} 예약됨`
                  : `${cell.dateId} ${statusLabel}`
              }
              aria-pressed={isSelected}
              className={[
                "calendar-day",
                "admin-calendar-day",
                !cell.isCurrentMonth ? "calendar-day-muted" : "",
                isReserved ? "calendar-day-reserved" : "",
                isPast && cell.isCurrentMonth ? "calendar-day-past" : "",
                isOutsidePeriod && cell.isCurrentMonth ? "calendar-day-outside" : "",
                groupRole === "start" && cell.isCurrentMonth
                  ? "calendar-day-weekend-group-start"
                  : "",
                groupRole === "middle" && cell.isCurrentMonth
                  ? "calendar-day-weekend-group-middle"
                  : "",
                groupRole === "end" && cell.isCurrentMonth
                  ? "calendar-day-weekend-group-end"
                  : "",
                isSelected ? "calendar-day-selected" : "",
              ].join(" ")}
              key={cell.dateId}
              onClick={() => onSelectDate(linkedFridayDateId)}
              title={
                isReserved && reservation
                  ? `${reservation.department} · ${reservation.name}`
                  : undefined
              }
              type="button"
            >
              <span>{cell.day}</span>
              {cell.isCurrentMonth ? (
                isReserved && reservation ? (
                  <small className="admin-calendar-reservation-label">{reservation.name}</small>
                ) : (
                  <small>{statusLabel}</small>
                )
              ) : null}
            </button>
          );
        })}
      </div>

      <div className="calendar-legend admin-calendar-legend" aria-label="예약 상태">
        <span>
          <i className="legend-dot legend-open" /> 가능
        </span>
        <span>
          <i className="legend-dot legend-reserved" /> 예약
        </span>
        <span>
          <i className="legend-dot legend-weekend" /> 금토일
        </span>
        {period ? (
          <span>
            <i className="legend-dot legend-outside" /> 기간 외
          </span>
        ) : null}
      </div>
    </section>
  );
}

function AdminReservationList({
  reservations,
  loading,
  onDelete,
  deletingId,
  period,
  periodLoading,
  periodSaving,
  onSavePeriod,
  selectedDate,
  onClearSelectedDate,
}: {
  reservations: Reservation[];
  loading: boolean;
  onDelete: (date: string) => void;
  deletingId: string;
  period: ReservationPeriod | null;
  periodLoading: boolean;
  periodSaving: boolean;
  onSavePeriod: (startDate: string, endDate: string) => Promise<void>;
  selectedDate: string;
  onClearSelectedDate: () => void;
}) {
  const todayId = getTodayId();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<AdminReservationFilter>("all");
  const [page, setPage] = useState(1);
  const [isPeriodModalOpen, setIsPeriodModalOpen] = useState(false);

  const filteredReservations = useMemo(() => {
    let items = reservations;

    if (selectedDate) {
      items = items.filter((item) => item.date === selectedDate);
    } else if (filter === "upcoming") {
      items = items.filter((item) => item.date >= todayId);
    } else if (filter === "past") {
      items = items.filter((item) => item.date < todayId);
    }

    const query = search.trim().toLowerCase();
    if (!query) {
      return items;
    }

    return items.filter(
      (item) =>
        item.name.toLowerCase().includes(query) ||
        item.department.toLowerCase().includes(query) ||
        item.employeeId.toLowerCase().includes(query) ||
        item.date.includes(query) ||
        formatDateId(item.date).toLowerCase().includes(query),
    );
  }, [filter, reservations, search, selectedDate, todayId]);

  const totalPages = Math.max(1, Math.ceil(filteredReservations.length / ADMIN_PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageStart = (currentPage - 1) * ADMIN_PAGE_SIZE;
  const pageEnd = Math.min(pageStart + ADMIN_PAGE_SIZE, filteredReservations.length);
  const paginatedReservations = filteredReservations.slice(pageStart, pageEnd);

  useEffect(() => {
    setPage(1);
  }, [search, filter, selectedDate]);

  useEffect(() => {
    if (page > totalPages) {
      setPage(totalPages);
    }
  }, [page, totalPages]);

  const filterCounts = useMemo(
    () => ({
      all: reservations.length,
      upcoming: reservations.filter((item) => item.date >= todayId).length,
      past: reservations.filter((item) => item.date < todayId).length,
    }),
    [reservations, todayId],
  );

  return (
    <section className="panel admin-list-panel" aria-label="전체 예약 목록">
      <div className="admin-list-header">
        <div>
          <p className="section-kicker">RESERVATIONS</p>
          <h2>전체 예약 목록</h2>
        </div>
        <div className="admin-list-header-actions">
          <div className="admin-period-inline" aria-live="polite">
            <span className="admin-period-inline-label">예약 가능 기간</span>
            {periodLoading ? (
              <span className="admin-period-inline-value">불러오는 중</span>
            ) : period ? (
              <strong className="admin-period-inline-value">
                {formatCompactReservationPeriod(period)}
              </strong>
            ) : (
              <strong className="admin-period-inline-value admin-period-inline-unset">미설정</strong>
            )}
          </div>
          <button
            className="secondary-button admin-period-button"
            onClick={() => setIsPeriodModalOpen(true)}
            type="button"
          >
            기간 설정
          </button>
          <span className="count-badge">{filteredReservations.length}</span>
        </div>
      </div>

      {selectedDate ? (
        <div className="admin-date-filter">
          <span>
            달력 선택: <strong>{formatDateId(selectedDate)}</strong>
          </span>
          <button className="secondary-button admin-date-filter-clear" onClick={onClearSelectedDate} type="button">
            선택 해제
          </button>
        </div>
      ) : null}

        <div className="admin-list-toolbar">
        <label className="admin-search-field">
          <span className="sr-only">예약 검색</span>
          <input
            onChange={(event) => setSearch(event.target.value)}
            placeholder="이름, 부서, 사번, 날짜 검색"
            type="search"
            value={search}
          />
        </label>
        <div
          className={`admin-filter-tabs${selectedDate ? " admin-filter-tabs-disabled" : ""}`}
          role="tablist"
          aria-label="예약 필터"
        >
          {(
            [
              ["all", "전체"],
              ["upcoming", "예정"],
              ["past", "지난 예약"],
            ] as const
          ).map(([value, label]) => (
            <button
              aria-selected={filter === value}
              className={filter === value ? "active" : undefined}
              disabled={Boolean(selectedDate)}
              key={value}
              onClick={() => setFilter(value)}
              role="tab"
              type="button"
            >
              {label}
              <span>{filterCounts[value]}</span>
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="empty-state admin-list-empty">불러오는 중입니다.</div>
      ) : filteredReservations.length === 0 ? (
        <div className="empty-state admin-list-empty">
          <strong>
            {reservations.length === 0
              ? "등록된 예약이 없습니다."
              : selectedDate
                ? `${formatDateId(selectedDate)} 예약 없음`
                : "검색 결과가 없습니다."}
          </strong>
          <span>
            {reservations.length === 0
              ? "공개 페이지에서 예약이 등록되면 여기에 표시됩니다."
              : selectedDate
                ? "선택한 날짜에 등록된 예약이 없습니다."
                : "검색어나 필터 조건을 변경해 보세요."}
          </span>
        </div>
      ) : (
        <>
          <p className="admin-list-summary">
            전체 {filteredReservations.length}건 중 {pageStart + 1}–{pageEnd}건 표시
          </p>
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th scope="col">날짜</th>
                  <th scope="col">부서</th>
                  <th scope="col">사번</th>
                  <th scope="col">이름</th>
                  <th scope="col">
                    <span className="sr-only">관리</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {paginatedReservations.map((reservation) => {
                  const isPast = reservation.date < todayId;

                  return (
                    <tr className={isPast ? "admin-table-row-past" : undefined} key={reservation.id}>
                      <td>{formatReservationUsagePeriod(reservation.date)}</td>
                      <td>{reservation.department}</td>
                      <td>{reservation.employeeId}</td>
                      <td>{reservation.name}</td>
                      <td className="admin-table-actions">
                        <button
                          className="danger-button admin-delete-button"
                          disabled={deletingId === reservation.date}
                          onClick={() => onDelete(reservation.date)}
                          type="button"
                        >
                          {deletingId === reservation.date ? "삭제 중" : "삭제"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {filteredReservations.length > ADMIN_PAGE_SIZE ? (
            <div className="admin-pagination">
              <button
                className="secondary-button"
                disabled={currentPage <= 1}
                onClick={() => setPage((value) => Math.max(1, value - 1))}
                type="button"
              >
                이전
              </button>
              <span>
                {currentPage} / {totalPages}
              </span>
              <button
                className="secondary-button"
                disabled={currentPage >= totalPages}
                onClick={() => setPage((value) => Math.min(totalPages, value + 1))}
                type="button"
              >
                다음
              </button>
            </div>
          ) : null}
        </>
      )}

      {isPeriodModalOpen ? (
        <ReservationPeriodModal
          loading={periodLoading}
          onClose={() => setIsPeriodModalOpen(false)}
          onSave={async (startDate, endDate) => {
            await onSavePeriod(startDate, endDate);
            setIsPeriodModalOpen(false);
          }}
          period={period}
          saving={periodSaving}
        />
      ) : null}
    </section>
  );
}

function ReservationPeriodModal({
  period,
  loading,
  saving,
  onSave,
  onClose,
}: {
  period: ReservationPeriod | null;
  loading: boolean;
  saving: boolean;
  onSave: (startDate: string, endDate: string) => Promise<void>;
  onClose: () => void;
}) {
  const [startDate, setStartDate] = useState(period?.startDate ?? "");
  const [endDate, setEndDate] = useState(period?.endDate ?? "");

  useEffect(() => {
    setStartDate(period?.startDate ?? "");
    setEndDate(period?.endDate ?? "");
  }, [period?.startDate, period?.endDate]);

  const canSave = startDate && endDate && !saving && !loading;

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await onSave(startDate, endDate);
  };

  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <section
        aria-labelledby="period-modal-title"
        aria-modal="true"
        className="request-modal admin-period-modal"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
      >
        <div className="modal-heading">
          <div>
            <p className="section-kicker">PERIOD</p>
            <h2 id="period-modal-title">예약 가능 기간 설정</h2>
          </div>
          <button
            aria-label="기간 설정 닫기"
            className="icon-button modal-close"
            onClick={onClose}
            type="button"
          >
            ×
          </button>
        </div>

        <p className="settings-copy">
          설정한 기간의 날짜만 예약할 수 있습니다. 기간 외 날짜는 공개 예약 페이지에서 선택할 수
          없습니다.
        </p>

        {period ? (
          <div className="modal-date-summary admin-period-summary">
            <span>현재 적용 중</span>
            <strong>{formatReservationPeriod(period)}</strong>
          </div>
        ) : (
          <div className="modal-date-summary admin-period-summary admin-period-summary-empty">
            <span>현재 적용 중인 기간 없음</span>
            <strong>저장하면 즉시 적용됩니다.</strong>
          </div>
        )}

        <form className="reservation-form period-form admin-period-form" onSubmit={onSubmit}>
          <label>
            시작일
            <input
              onChange={(event) => setStartDate(event.target.value)}
              type="date"
              value={startDate}
            />
          </label>
          <label>
            종료일
            <input
              onChange={(event) => setEndDate(event.target.value)}
              type="date"
              value={endDate}
            />
          </label>
          <div className="admin-period-modal-actions">
            <button className="secondary-button" onClick={onClose} type="button">
              취소
            </button>
            <button className="primary-button" disabled={!canSave} type="submit">
              {saving ? "저장 중" : "기간 저장"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

function AdminPage() {
  const { toasts, pushToast, removeToast } = useToasts();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authLoading, setAuthLoading] = useState(true);
  const [loginLoading, setLoginLoading] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [adminAllowed, setAdminAllowed] = useState(false);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [reservationsLoading, setReservationsLoading] = useState(true);
  const [reservationPeriod, setReservationPeriod] = useState<ReservationPeriod | null>(null);
  const [periodLoading, setPeriodLoading] = useState(true);
  const [periodSaving, setPeriodSaving] = useState(false);
  const [deletingId, setDeletingId] = useState("");
  const [selectedCalendarDate, setSelectedCalendarDate] = useState("");

  useEffect(() => {
    return onAuthStateChanged(auth, (nextUser) => {
      setUser(nextUser);
      setAuthLoading(false);
      setAdminAllowed(nextUser ? isAdminUser(nextUser) : false);
    });
  }, []);

  useEffect(() => {
    if (!user || !adminAllowed) {
      setReservations([]);
      setReservationsLoading(false);
      return;
    }

    setReservationsLoading(true);
    const unsubscribe = subscribeReservations(
      (nextReservations) => {
        setReservations(nextReservations);
        setReservationsLoading(false);
      },
      (error) => {
        setReservationsLoading(false);
        pushToast({
          tone: "error",
          title: "예약 목록 접근에 실패했습니다.",
          description: error.message,
        });
      },
    );

    return unsubscribe;
  }, [user, adminAllowed]);

  useEffect(() => {
    if (!user || !adminAllowed) {
      setReservationPeriod(null);
      setPeriodLoading(false);
      return;
    }

    setPeriodLoading(true);
    const unsubscribe = subscribeReservationPeriod(
      (period) => {
        setReservationPeriod(period);
        setPeriodLoading(false);
      },
      (error) => {
        setPeriodLoading(false);
        pushToast({
          tone: "error",
          title: "예약 기간 설정을 불러오지 못했습니다.",
          description: error.message,
        });
      },
    );

    return unsubscribe;
  }, [user, adminAllowed]);

  const saveReservationPeriod = async (startDate: string, endDate: string) => {
    setPeriodSaving(true);

    try {
      await updateReservationPeriod(startDate, endDate);
      pushToast({
        tone: "success",
        title: "예약 가능 기간을 저장했습니다.",
        description: `${formatDateId(startDate)} ~ ${formatDateId(endDate)}`,
      });
    } catch (error) {
      pushToast({
        tone: "error",
        title: "예약 기간 저장에 실패했습니다.",
        description: error instanceof Error ? error.message : "관리자 권한을 확인하세요.",
      });
      throw error;
    } finally {
      setPeriodSaving(false);
    }
  };

  const login = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoginLoading(true);

    try {
      await signInWithEmailAndPassword(auth, email.trim(), password);
      setPassword("");
      pushToast({ tone: "success", title: "로그인했습니다." });
    } catch (error) {
      pushToast({
        tone: "error",
        title: "로그인에 실패했습니다.",
        description: getAuthErrorMessage(error),
      });
    } finally {
      setLoginLoading(false);
    }
  };

  const removeReservation = async (date: string) => {
    const reservation = reservations.find((item) => item.date === date);
    const label = reservation ? `${formatDateId(reservation.date)} ${reservation.name}` : date;

    if (!window.confirm(`${label} 예약을 삭제할까요?`)) {
      return;
    }

    setDeletingId(date);

    try {
      await deleteReservation(date);
      pushToast({ tone: "success", title: "예약을 삭제했습니다." });
    } catch (error) {
      pushToast({
        tone: "error",
        title: "예약 삭제에 실패했습니다.",
        description: error instanceof Error ? error.message : "관리자 권한을 확인하세요.",
      });
    } finally {
      setDeletingId("");
    }
  };

  return (
    <div className="app-shell admin-shell">
      <ToastStack toasts={toasts} onRemove={removeToast} />
      <header className="admin-header">
        <div>
          <p className="eyebrow">ADMIN</p>
          <h1>예약 관리</h1>
        </div>
        {user ? (
          <button className="secondary-button" onClick={() => signOut(auth)} type="button">
            로그아웃
          </button>
        ) : null}
      </header>

      {authLoading ? (
        <section className="panel admin-card">
          <div className="empty-state">로그인 상태를 확인하는 중입니다.</div>
        </section>
      ) : !user ? (
        <section className="panel admin-card" aria-label="관리자 로그인">
          <div className="panel-heading">
            <div>
              <p className="section-kicker">SECURE</p>
              <h2>관리자 로그인</h2>
            </div>
          </div>
          <form className="reservation-form" onSubmit={login}>
            <label>
              이메일
              <input
                autoComplete="email"
                onChange={(event) => setEmail(event.target.value)}
                placeholder="admin@example.com"
                type="email"
                value={email}
              />
            </label>
            <label>
              비밀번호
              <input
                autoComplete="current-password"
                onChange={(event) => setPassword(event.target.value)}
                placeholder="비밀번호"
                type="password"
                value={password}
              />
            </label>
            <button className="primary-button" disabled={loginLoading || !email || !password} type="submit">
              {loginLoading ? "로그인 중" : "로그인"}
            </button>
          </form>
        </section>
      ) : !adminAllowed ? (
        <section className="panel admin-card">
          <div className="empty-state">
            <strong>관리자 권한이 없습니다.</strong>
            <span>VITE_ADMIN_UIDS와 firestore.rules에 관리자 UID를 추가하세요.</span>
          </div>
        </section>
      ) : (
        <main className="admin-layout">
          <AdminReservationCalendar
            onSelectDate={(dateId) =>
              setSelectedCalendarDate((current) => (current === dateId ? "" : dateId))
            }
            period={reservationPeriod}
            reservations={reservations}
            selectedDate={selectedCalendarDate}
          />
          <AdminReservationList
            deletingId={deletingId}
            loading={reservationsLoading}
            onClearSelectedDate={() => setSelectedCalendarDate("")}
            onDelete={removeReservation}
            onSavePeriod={saveReservationPeriod}
            period={reservationPeriod}
            periodLoading={periodLoading}
            periodSaving={periodSaving}
            reservations={reservations}
            selectedDate={selectedCalendarDate}
          />
        </main>
      )}
    </div>
  );
}

function getAuthErrorMessage(error: unknown) {
  if (!(error instanceof FirebaseError)) {
    return "이메일과 비밀번호를 확인하세요.";
  }

  if (error.code === "auth/invalid-credential" || error.code === "auth/user-not-found") {
    return "이메일 또는 비밀번호가 올바르지 않습니다.";
  }

  if (error.code === "auth/too-many-requests") {
    return "요청이 많습니다. 잠시 후 다시 시도하세요.";
  }

  return error.message;
}

export default App;
