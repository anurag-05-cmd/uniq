package com.cedarqueue;

import jakarta.persistence.*;
import java.time.Instant;
import java.util.*;

enum Role { CUSTOMER, HOST, MANAGER, DISPLAY }
enum TableStatus { AVAILABLE, ASSIGNED, OCCUPIED, UNAVAILABLE }
enum SessionStatus { OPEN, CLOSING, CLOSED }
enum EntryStatus {
    WAITING, ARRIVAL_WINDOW, CHECKED_IN, SNOOZED, CALLED, SEATED, DINING, COMPLETED, CANCELLED, EXPIRED, NO_SHOW;
    boolean terminal() { return Set.of(COMPLETED,CANCELLED,EXPIRED,NO_SHOW).contains(this); }
    boolean dining() { return this == SEATED || this == DINING; }
    boolean pending() { return Set.of(WAITING,ARRIVAL_WINDOW,CHECKED_IN,SNOOZED).contains(this); }
}

@MappedSuperclass
abstract class Versioned {
    @Id UUID id = UUID.randomUUID();
    @Version long version;
}
@Entity @Table(name="account")
class Account extends Versioned {
    String email;
    String passwordHash;
    String displayName;
    @Enumerated(EnumType.STRING) Role role = Role.CUSTOMER;
    boolean enabled = true;
    Instant createdAt = Instant.now();
    protected Account() {}
}
@Entity @Table(name="restaurant")
class Restaurant extends Versioned {
    String name = "The Cedar Table";
    String location = "Riverside District";
    String timezone = "Asia/Kolkata";
    String description = "Seasonal plates. Thoughtful hospitality. Your table, without the line.";
    @Column(columnDefinition="text") String policyJson;
    UUID currentSessionId;
    boolean recoveryRequired;
    Instant heartbeatAt;
    protected Restaurant() {}
}
@Entity @Table(name="dining_area")
class DiningArea extends Versioned {
    UUID restaurantId;
    String name;
    protected DiningArea() {}
}
@Entity @Table(name="restaurant_table")
class RestaurantTable extends Versioned {
    UUID restaurantId;
    UUID areaId;
    String number;
    int capacity;
    boolean accessible;
    boolean enabled = true;
    @Enumerated(EnumType.STRING) TableStatus status = TableStatus.AVAILABLE;
    Instant createdAt = Instant.now();
    protected RestaurantTable() {}
}
@Entity @Table(name="operating_session")
class OperatingSession extends Versioned {
    UUID restaurantId;
    Instant opensAt;
    Instant closesAt;
    Instant closedAt;
    @Enumerated(EnumType.STRING) SessionStatus status = SessionStatus.OPEN;
    long nextSequence = 1;
    long revision;
    int priorityBurst;
    @Column(columnDefinition="text") String policyJson;
    protected OperatingSession() {}
}
@Entity @Table(name="waitlist_entry")
class WaitlistEntry extends Versioned {
    UUID sessionId;
    UUID customerId;
    String token;
    long sequence;
    int partySize;
    String preference;
    boolean accessible;
    @Enumerated(EnumType.STRING) EntryStatus status = EntryStatus.WAITING;
    Instant joinedAt;
    Instant fairnessSince;
    Instant checkedInAt;
    Instant arrivalWindowOpenedAt;
    Instant arrivalDeadline;
    Instant calledAt;
    Instant callDeadline;
    Instant snoozeReleaseAt;
    Instant terminalAt;
    int snoozeCount;
    boolean priority;
    UUID priorityVerifiedBy;
    String priorityReason;
    UUID tableId;
    String terminalReason;
    @org.hibernate.annotations.OptimisticLock(excluded=true) Long etaSeconds;
    @org.hibernate.annotations.OptimisticLock(excluded=true) Instant estimatedStartAt;
    @org.hibernate.annotations.OptimisticLock(excluded=true) Instant computedAt;
    @org.hibernate.annotations.OptimisticLock(excluded=true) String estimateSource = "DEFAULT";
    @org.hibernate.annotations.OptimisticLock(excluded=true) int sampleCount;
    @org.hibernate.annotations.OptimisticLock(excluded=true) String confidence = "LOW";
    @org.hibernate.annotations.OptimisticLock(excluded=true) boolean assumesArrival = true;
    @org.hibernate.annotations.OptimisticLock(excluded=true) Integer position;
    protected WaitlistEntry() {}
}
@Entity @Table(name="dining_visit")
class DiningVisit extends Versioned {
    UUID entryId;
    UUID tableId;
    int partySize;
    Instant startedAt;
    Instant completedAt;
    Long durationSeconds;
    boolean sampleValid;
    protected DiningVisit() {}
}
@Entity @Table(name="arrival")
class Arrival extends Versioned {
    UUID entryId;
    UUID challengeId;
    String method;
    Instant verifiedAt;
    UUID verifiedBy;
    String reason;
    protected Arrival() {}
}
@Entity @Table(name="qr_challenge")
class QrChallenge extends Versioned {
    UUID restaurantId;
    String digest;
    Instant issuedAt;
    Instant expiresAt;
    protected QrChallenge() {}
}
@Entity @Table(name="snooze_barrier")
class SnoozeBarrier extends Versioned {
    UUID entryId;
    UUID predecessorId;
    int snoozeNumber;
    Instant releasedAt;
    String releaseReason;
    protected SnoozeBarrier() {}
}
@Entity @Table(name="queue_history")
class QueueHistory extends Versioned {
    UUID entryId;
    UUID tableId;
    String fromStatus;
    String toStatus;
    String action;
    String actor;
    String reason;
    Instant occurredAt;
    long revision;
    protected QueueHistory() {}
}
@Entity @Table(name="audit_event")
class AuditEvent extends Versioned {
    UUID entryId;
    String action;
    String actor;
    String reason;
    Instant occurredAt;
    @Column(columnDefinition="text") String details;
    protected AuditEvent() {}
}
@Entity @Table(name="table_history")
class TableHistory extends Versioned {
    UUID tableId;
    String oldStatus;
    String newStatus;
    boolean enabled;
    Instant occurredAt;
    protected TableHistory() {}
}
@Entity @Table(name="outbox_event")
class OutboxEvent extends Versioned {
    UUID entryId;
    UUID recipientId;
    String kind;
    String title;
    String body;
    Instant createdAt;
    Instant processedAt;
    protected OutboxEvent() {}
}
@Entity @Table(name="notification")
class Notification extends Versioned {
    UUID eventId;
    UUID recipientId;
    String kind;
    String title;
    String body;
    Instant createdAt;
    Instant readAt;
    protected Notification() {}
}
@Entity @Table(name="idempotency_record", uniqueConstraints=@UniqueConstraint(columnNames={"actor_id","route","request_key"}))
class IdempotencyRecord extends Versioned {
    UUID actorId;
    String route;
    String requestKey;
    String requestHash;
    @Column(columnDefinition="text") String responseJson;
    Instant createdAt;
    protected IdempotencyRecord() {}
}
@Entity @Table(name="feedback")
class Feedback extends Versioned {
    UUID entryId;
    UUID customerId;
    int rating;
    String comment;
    Instant createdAt;
    protected Feedback() {}
}
