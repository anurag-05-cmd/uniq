package com.cedarqueue;

import java.util.*;

final class Lifecycle {
    private static final Map<EntryStatus,Set<EntryStatus>> LEGAL = Map.of(
        EntryStatus.WAITING,Set.of(EntryStatus.ARRIVAL_WINDOW,EntryStatus.SNOOZED,EntryStatus.CANCELLED),
        EntryStatus.ARRIVAL_WINDOW,Set.of(EntryStatus.CHECKED_IN,EntryStatus.SNOOZED,EntryStatus.CANCELLED,EntryStatus.EXPIRED),
        EntryStatus.CHECKED_IN,Set.of(EntryStatus.CALLED,EntryStatus.SNOOZED,EntryStatus.CANCELLED),
        EntryStatus.SNOOZED,Set.of(EntryStatus.WAITING,EntryStatus.CHECKED_IN,EntryStatus.CANCELLED),
        EntryStatus.CALLED,Set.of(EntryStatus.SEATED,EntryStatus.CANCELLED,EntryStatus.NO_SHOW),
        EntryStatus.SEATED,Set.of(EntryStatus.DINING,EntryStatus.COMPLETED),
        EntryStatus.DINING,Set.of(EntryStatus.COMPLETED));
    static void require(EntryStatus from,EntryStatus to) {
        if (!LEGAL.getOrDefault(from,Set.of()).contains(to)) throw Problem.conflict("STATE_CONFLICT","Cannot change "+from+" to "+to+".");
    }
}
