package com.cedarqueue;

import jakarta.validation.constraints.*;
import java.time.Instant;
import java.util.UUID;

final class Requests {
    record Register(@Email @NotBlank @Size(max=254) String email,@NotBlank @Size(min=12,max=72) String password,@NotBlank @Size(max=100) String displayName) {}
    record Join(@Min(1) @Max(20) int partySize,@Size(max=100) String preference,boolean accessible) {}
    record Change(@PositiveOrZero Long expectedVersion,@Size(max=500) String reason,UUID tableId,Boolean priority,@Size(max=128) String challenge) {}
    record Availability(@NotNull TableStatus status,boolean enabled,@NotBlank @Size(max=500) String reason,@NotNull @PositiveOrZero Long expectedVersion) {}
    record TableInput(@NotBlank @Size(max=20) String number,@NotNull UUID areaId,@Min(1) @Max(20) int capacity,boolean accessible,boolean enabled,Long expectedVersion,@Size(max=500) String reason) {}
    record AreaInput(@NotBlank @Size(max=100) String name) {}
    record RestaurantInput(@NotBlank @Size(max=120) String name,@NotBlank @Size(max=200) String location,@NotBlank @Size(max=64) String timezone,@Size(max=1000) String description,@NotBlank @Size(max=500) String reason) {}
    record SessionInput(@NotBlank @Size(max=500) String reason,@Min(60) @Max(1800) Integer graceSeconds,Instant opensAt,Instant closesAt) {}
    record FeedbackInput(@Min(1) @Max(5) int rating,@Size(max=1000) String comment) {}
    record StaffInput(@Email @NotBlank String email,@NotBlank @Size(min=12,max=72) String password,@NotBlank @Size(max=100) String displayName,@NotNull Role role) {}
    record Simulation(@Min(1) @Max(60) Integer count,UUID tableId) {}
}
