# Restaurant Smart Queue Optimizer — Diagrams

These diagrams describe the implemented single-restaurant workflow. Mermaid blocks render in GitHub and compatible Markdown viewers.

## 1. Call-next decision tree

```mermaid
flowchart TD
    A[Host requests Call next] --> B{Restaurant open and not in recovery?}
    B -- No --> Z[Reject action; explain service state]
    B -- Yes --> C[Load eligible parties and available tables]
    C --> D{Checked-in, not snoozed party exists?}
    D -- No --> E[Keep queue; refresh ETA]
    D -- Yes --> F[Build party-table pairs]
    F --> G{Table capacity sufficient?}
    G -- No --> H[Discard pair]
    G -- Yes --> I{Accessibility needs met?}
    I -- No --> H
    I -- Yes --> J[Score age, priority, preference, and spare capacity]
    H --> K{Any compatible pair remains?}
    J --> K
    K -- No --> E
    K -- Yes --> L{Priority burst limit reached and normal party eligible?}
    L -- Yes --> M[Choose oldest eligible normal party]
    L -- No --> N{Any compatible party past starvation threshold?}
    N -- Yes --> O[Choose oldest overdue compatible party]
    N -- No --> P[Choose highest-scoring party-table pair]
    M --> Q[Lock and revalidate queue and table]
    O --> Q
    P --> Q
    Q --> R{Still valid and table available?}
    R -- No --> C
    R -- Yes --> S[Assign table; persist audit and call deadline]
    S --> T[Notify customer and publish live update]
```

## 2. Allocation decision table

Rules are evaluated after the restaurant/session lock and server-side state revalidation. A table is only considered when its state is `AVAILABLE` and it is enabled.

| Party checked in? | Table enabled and available? | Capacity fits? | Accessibility fits? | Priority burst / fairness | Outcome |
|---|---|---|---|---|---|
| No | Any | Any | Any | Any | Party is ineligible for dispatch |
| Yes | No | Any | Any | Any | Exclude table |
| Yes | Yes | No | Any | Any | Exclude party-table pair |
| Yes | Yes | Yes | No | Any | Exclude party-table pair |
| Yes | Yes | Yes | Yes | Normal party waiting and priority burst limit reached | Choose oldest eligible normal party |
| Yes | Yes | Yes | Yes | Compatible party has exceeded starvation threshold | Choose oldest overdue compatible party |
| Yes | Yes | Yes | Yes | Otherwise | Rank compatible pairs by fairness age, verified priority, preferred area, and capacity efficiency |
| Any | Conflicting concurrent update | Any | Any | Any | Revalidate under lock; reject stale request or recompute |

A party of two can use a 2-, 4-, 6- or 8-seat table; scoring favors the smaller suitable table. A party of six cannot use a 2- or 4-seat table. Accessibility is a hard constraint; dining-area preference is a soft preference. Hosts can make audited assignment changes while preserving these physical constraints.

## 3. Use case diagram

```mermaid
flowchart LR
    Customer([Customer])
    Host([Host / Operator])
    Manager([Manager / Admin])
    DisplayUser([Display account])
    Optimizer((Queue optimizer))
    Platform[Restaurant Smart Queue Optimizer]

    Customer -->|Register, sign in| Platform
    Customer -->|Join, view ETA and position| Platform
    Customer -->|Scan QR / assisted check-in| Platform
    Customer -->|Snooze, cancel, feedback| Platform
    Customer -->|Receive notifications and live status| Platform
    Host -->|Check in and approve priority| Platform
    Host -->|Call, assign, seat, complete, no-show| Platform
    Host -->|Update table availability| Platform
    Manager -->|Configure restaurant, areas, tables, policy, sessions| Platform
    Manager -->|Review analytics and audit history| Platform
    Manager -->|Run or reset demo simulation| Platform
    DisplayUser -->|Sign in and show anonymous calls / rotating QR| Platform
    Platform -->|Recalculate ETA and compatible allocation| Optimizer
    Optimizer -->|Recommended party-table pair| Platform
```

## 4. Data flow diagram — Level 0 (context)

```mermaid
flowchart LR
    C[Customer]
    H[Host / Operator]
    M[Manager]
    D[Public Display]
    Q((0. Restaurant Smart Queue Optimizer))
    PG[(PostgreSQL)]

    C -->|Account, party details, QR check-in, snooze/cancel, feedback| Q
    Q -->|Token, ETA, status, notifications, table-ready updates| C
    H -->|Assisted check-in, calls, table and visit actions| Q
    Q -->|Live queue, suggested table, visit and table status| H
    M -->|Restaurant, staff, table and policy settings; demo commands| Q
    Q -->|Analytics, audit history and configuration results| M
    Q -->|Rotating QR challenge and anonymized called tokens| D
    D -->|Authenticated display session / refresh request| Q
    Q <-->|Persisted accounts, queue, configuration, visits, QR, audit and outbox| PG
```

## 5. Data flow diagram — Level 1

```mermaid
flowchart LR
    C[Customer]
    H[Host / Operator]
    M[Manager]
    D[Public Display]

    P1((1. Identity and access))
    P2((2. Waitlist lifecycle))
    P3((3. ETA and allocation))
    P4((4. Arrival and QR))
    P5((5. Operations and notifications))
    P6((6. Analytics, audit and demo))

    S1[(D1 Accounts and sessions)]
    S2[(D2 Restaurant, areas, tables and policy)]
    S3[(D3 Entries, arrivals and snooze barriers)]
    S4[(D4 Visits and table history)]
    S5[(D5 QR challenges and idempotency)]
    S6[(D6 Audit, outbox and notifications)]

    C -->|Credentials, registration| P1
    H -->|Staff credentials| P1
    M -->|Manager credentials| P1
    D -->|Display credentials| P1
    P1 <-->|Account roles and database-backed sessions| S1

    C -->|Join, snooze, cancel, feedback| P2
    H -->|Assisted check-in, call, seat, finish visit| P2
    P1 -->|Authenticated identity and role| P2
    P2 <-->|Entry state, sequence and persisted deadlines| S3
    P2 -->|Entry/table state changes| P3
    P3 <-->|Queue snapshot, service history, table compatibility and projections| S2
    P3 <-->|Recent completed dining samples| S4
    P3 -->|ETA and suggested compatible table| P2
    P2 -->|Status, token and estimate| C
    P2 -->|Queue board and assignment result| H

    C -->|Signed-in check-in challenge| P4
    D -->|Current rotating challenge and display refresh| P4
    P4 <-->|Challenge digest, expiry and replay key| S5
    P4 -->|Verified arrival| P2

    P2 -->|Committed event and deadline| P5
    P5 -->|Persisted notifications and audit events| S6
    P5 -->|Live refresh signal and in-app notification| C
    P5 -->|Live refresh signal| H
    P5 -->|Anonymized called token and QR refresh| D

    M -->|Venue, policy, area, table, session changes| P6
    M -->|Development simulation command| P6
    P6 <-->|Configuration and table history| S2
    P6 <-->|Operational records and events| S3
    P6 <-->|Dining outcomes and duration| S4
    P6 <-->|Audit and notification history| S6
    P6 -->|Analytics, configuration result and audit view| M
```
