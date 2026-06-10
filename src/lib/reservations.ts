import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  type Timestamp,
} from "firebase/firestore";
import { db } from "./firebase";
import { getReservationWindow, isReservableDateId } from "./dates";
import { ReservationPeriodError } from "./settings";

export type Reservation = {
  id: string;
  date: string;
  startAt: Timestamp;
  endAt: Timestamp;
  employeeId: string;
  department: string;
  name: string;
  createdAt?: Timestamp;
};

export type ReservationInput = {
  date: string;
  employeeId: string;
  department: string;
  name: string;
};

export class ReservationConflictError extends Error {
  constructor() {
    super("이미 예약됐습니다.");
    this.name = "ReservationConflictError";
  }
}

export class ReservationUnavailableDateError extends Error {
  constructor() {
    super("토요일과 일요일은 금요일 예약에 포함됩니다.");
    this.name = "ReservationUnavailableDateError";
  }
}

const reservationsRef = collection(db, "reservations");

export function subscribeReservations(
  onNext: (reservations: Reservation[]) => void,
  onError: (error: Error) => void,
) {
  return onSnapshot(
    query(reservationsRef, orderBy("startAt", "asc")),
    (snapshot) => {
      onNext(
        snapshot.docs.map((reservationDoc) => ({
          id: reservationDoc.id,
          ...(reservationDoc.data() as Omit<Reservation, "id">),
        })),
      );
    },
    onError,
  );
}

export async function createReservation(input: ReservationInput) {
  if (!isReservableDateId(input.date)) {
    throw new ReservationUnavailableDateError();
  }

  const reservationDocRef = doc(db, "reservations", input.date);
  const settingsDocRef = doc(db, "settings", "reservation");
  const { startAt, endAt } = getReservationWindow(input.date);

  await runTransaction(db, async (transaction) => {
    const reservationDoc = await transaction.get(reservationDocRef);
    const settingsDoc = await transaction.get(settingsDocRef);

    if (settingsDoc.exists()) {
      const { startDate, endDate } = settingsDoc.data();

      if (
        typeof startDate === "string" &&
        typeof endDate === "string" &&
        (input.date < startDate || input.date > endDate)
      ) {
        throw new ReservationPeriodError();
      }
    }

    if (reservationDoc.exists()) {
      throw new ReservationConflictError();
    }

    transaction.set(reservationDocRef, {
      date: input.date,
      startAt,
      endAt,
      employeeId: input.employeeId.trim(),
      department: input.department.trim(),
      name: input.name.trim(),
      createdAt: serverTimestamp(),
    });
  });
}

export async function deleteReservation(date: string) {
  await deleteDoc(doc(db, "reservations", date));
}
