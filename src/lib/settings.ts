import {
  doc,
  onSnapshot,
  serverTimestamp,
  setDoc,
  type Timestamp,
} from "firebase/firestore";
import { db } from "./firebase";
import { formatCompactDateId, formatDateId } from "./dates";

export type ReservationPeriod = {
  startDate: string;
  endDate: string;
  updatedAt?: Timestamp;
};

export class ReservationPeriodError extends Error {
  constructor() {
    super("예약 가능 기간이 아닙니다.");
    this.name = "ReservationPeriodError";
  }
}

const settingsDocRef = doc(db, "settings", "reservation");

export function subscribeReservationPeriod(
  onNext: (period: ReservationPeriod | null) => void,
  onError: (error: Error) => void,
) {
  return onSnapshot(
    settingsDocRef,
    (snapshot) => {
      if (!snapshot.exists()) {
        onNext(null);
        return;
      }

      const data = snapshot.data();
      if (typeof data.startDate === "string" && typeof data.endDate === "string") {
        onNext({
          startDate: data.startDate,
          endDate: data.endDate,
          updatedAt: data.updatedAt,
        });
        return;
      }

      onNext(null);
    },
    onError,
  );
}

export async function updateReservationPeriod(startDate: string, endDate: string) {
  if (!startDate || !endDate) {
    throw new Error("시작일과 종료일을 모두 입력하세요.");
  }

  if (startDate > endDate) {
    throw new Error("시작일은 종료일보다 이후일 수 없습니다.");
  }

  await setDoc(
    settingsDocRef,
    {
      startDate,
      endDate,
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );
}

export function isDateWithinPeriod(dateId: string, period: ReservationPeriod | null) {
  if (!period) {
    return true;
  }

  return dateId >= period.startDate && dateId <= period.endDate;
}

export function formatReservationPeriod(period: ReservationPeriod) {
  return `${formatDateId(period.startDate)} ~ ${formatDateId(period.endDate)}`;
}

export function formatCompactReservationPeriod(period: ReservationPeriod) {
  return `${formatCompactDateId(period.startDate)} ~ ${formatCompactDateId(period.endDate)}`;
}
