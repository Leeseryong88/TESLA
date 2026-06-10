# Tesla Model X 사내 예약 웹앱

React, Vite, Firebase Web SDK, Cloud Firestore, Firebase Authentication 기반 예약 앱입니다.

## 실행

```bash
npm install
npm run dev
```

공개 예약 페이지는 `/`, 관리자 페이지는 `/admin`입니다. 공개 화면에는 관리자 링크를 노출하지 않습니다.

## Firebase 설정

Firebase 연결 정보는 [src/lib/firebase.ts](src/lib/firebase.ts)에 분리되어 있습니다. Firestore 컬렉션은 `reservations`를 사용하고, 문서 ID는 `YYYY-MM-DD` 형식의 예약 날짜입니다.

관리자 권한은 둘 중 하나로 판별합니다.

- Firebase Auth 사용자에게 `admin: true` custom claim 부여
- `.env`의 `VITE_ADMIN_UIDS`와 [firestore.rules](firestore.rules)의 UID 목록에 관리자 UID 추가

Firestore 보안 규칙 배포:

```bash
firebase deploy --only firestore:rules
```

## 데이터 구조

```ts
{
  date: "2026-06-12",
  startAt: Timestamp,
  endAt: Timestamp,
  employeeId: string,
  department: string,
  name: string,
  createdAt: serverTimestamp()
}
```

예약 생성은 `runTransaction`으로 처리합니다. 같은 날짜 문서가 이미 있으면 transaction 내부에서 실패시키며, UI에는 `이미 예약됐습니다.` 메시지를 표시합니다.
