# Shared implementation contract

Restaurant adaptation: one configured venue, venue-wide operating session and allocation; no fixed table binding until called. Join age stays immutable. Snooze preserves joinedAt but resets fairnessSince on release, per blueprint. Preferences are soft area choices; accessibility is a hard table capability. All queue mutations take the venue/session database lock and enforce versions, constraints and idempotency. Forecasting and dispatch share selection rules.

Backend package `com.cedarqueue`. API base `/api/v1`. JSON camelCase. UUID identifiers. Java 25, Spring Boot BOM 4.1.1 (verify registry availability). Roles CUSTOMER, HOST, MANAGER, DISPLAY. Spring Security session + CSRF. Errors ProblemDetail with `detail`, `code`. All mutations send `Idempotency-Key`; entry mutations send `expectedVersion`. Login form URL encoded username/password; all others JSON.

## API and DTO agreement

- GET `/auth/csrf` -> `{token,headerName}`
- POST `/auth/register` `{email,password,displayName}` -> User
- POST `/auth/login` (form) -> User
- POST `/auth/logout` -> 204
- GET `/me` -> User `{id,email,displayName,role}`
- GET `/restaurant` public -> `{id,name,location,timezone,description,open,demoMode,serverTime,sessionId,sessionStatus,recoveryRequired,policy,areas,tables,waitingCount}`
- GET `/me/entries` -> Entry[] newest first
- POST `/entries` `{partySize,preference,accessible}` -> Entry
- GET `/entries/{id}` -> Entry (owner/staff)
- POST `/entries/{id}/check-in` `{challenge,expectedVersion}` -> Entry
- POST `/entries/{id}/snooze` `{expectedVersion}` -> Entry
- POST `/entries/{id}/cancel` `{expectedVersion,reason}` -> Entry
- POST `/entries/{id}/feedback` `{rating,comment}` -> `{id,rating,comment}`
- GET `/me/notifications` -> `{id,kind,title,body,createdAt,readAt}[]`
- POST `/me/notifications/{id}/read` -> 204
- GET `/host/board` -> `{entries,tables,visits,revision,serverTime,suggestions}`
- POST `/host/call-next` `{tableId?:string,expectedVersion?:number}` -> Entry or 204; no tableId means globally optimized pair
- POST `/host/entries/{id}/{action}` where action is `assist`, `priority`, `assign`, `seat`, `dining`, `complete`, `no-show`; body `{expectedVersion,reason?,tableId?,priority?}` -> Entry
- POST `/host/tables/{id}/availability` `{status,enabled,reason,expectedVersion}` -> Table
- GET `/admin/analytics` -> `{averageWaitMinutes,averageDiningMinutes,completedParties,cancellations,noShows,utilizationPercent,throughputPerHour,queueTrends:[{hour,joined,completed}],tableUtilization:[{tableNumber,utilizationPercent}],sampleCount,asOf}`
- GET `/admin/audit` -> `{id,action,actor,reason,occurredAt,entryId?,details?}[]`
- PUT `/admin/restaurant` `{name,location,timezone,description,reason}`
- PUT `/admin/policy` Policy plus `reason`
- POST `/admin/areas` `{name}` -> Area
- POST `/admin/tables` `{number,areaId,capacity,accessible,enabled}` -> Table
- PUT `/admin/tables/{id}` `{number,areaId,capacity,accessible,enabled,expectedVersion,reason}` -> Table
- POST `/admin/session/{action}` action `open`, `close`, `recover`; `{reason,graceSeconds?,opensAt?,closesAt?}`
- GET `/admin/staff` -> User[]
- POST `/admin/staff` `{email,password,displayName,role}` -> User (HOST/MANAGER/DISPLAY)
- GET `/display/board` -> `{restaurantName,called:[{token,tableNumber,areaName}],challenge,expiresAt,serverTime}`. DISPLAY/HOST/MANAGER only; display account login. Challenge raw value never available on customer/public API.
- GET `/events` authenticated SSE `event: refresh`, `data: {revision,serverTime}` (no private payload), heartbeat; reconnect triggers GET.
- POST `/demo/{action}` MANAGER demo profile only: `add`, `rush`, `occupy`, `free`, `complete`, `no-show`, `activity`, `reset`; body `{count?,tableId?}` -> summary `{message}`.

Entry `{id,token,customerName?,partySize,preference,accessible,status,joinedAt,fairnessSince,checkedInAt,arrivalWindowOpenedAt,arrivalDeadline,callDeadline,snoozeReleaseAt,snoozeCount,snoozesRemaining,priority,tableId,tableNumber,areaName,etaSeconds,estimatedStartAt,computedAt,estimateSource,sampleCount,confidence,assumesArrival,position,version,terminalReason}`. States WAITING, ARRIVAL_WINDOW, CHECKED_IN, SNOOZED, CALLED, SEATED, DINING, COMPLETED, CANCELLED, EXPIRED, NO_SHOW. Table `{id,number,areaId,areaName,capacity,accessible,status,enabled,version}`; states AVAILABLE, ASSIGNED, OCCUPIED, UNAVAILABLE. Area `{id,name}`. Visit `{id,entryId,token,tableId,tableNumber,partySize,startedAt,completedAt,durationSeconds}`.

Policy `{arrivalLeadMinutes,arrivalGraceMinutes,callGraceMinutes,maxSnoozes,snoozeMinutes,snoozeSpots,priorityBurstLimit,agingMinutes,starvationMinutes,sampleSize,sampleHorizonMinutes,minimumSamples,defaultDiningMinutes,maxActiveParties,capacityWastePenalty}`. Defaults 10,5,2,2,10,3,2,5,30,20,120,5,45,500,3.

Frontend paths `/`, `/login`, `/host`, `/manager`, `/display`, `/check-in?challenge=...`. Display QR encodes current browser origin `/check-in?challenge=...` so phone camera app opens frontend and login retains challenge. In-app scanner supports camera and pasted decoded payload/link fallback. Customer never downloads challenge directly.

Demo credentials all use password `CedarDemo!2026`: `customer@cedar.local`, `host@cedar.local`, `manager@cedar.local`, `display@cedar.local`. Only demo/dev profile seeds these.
