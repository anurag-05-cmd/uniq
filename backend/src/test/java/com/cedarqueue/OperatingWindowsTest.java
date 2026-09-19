package com.cedarqueue;

import org.junit.jupiter.api.Test;
import java.time.*;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

class OperatingWindowsTest {
    Instant at(int hour) {return Instant.parse("2026-09-19T00:00:00Z").plusSeconds(hour*3600L);}
    @Test void earlyClosureAndNextSessionExcludeTheClosedGap() {
        var windows=OperatingWindows.between(List.of(new OperatingWindows.Session(at(0),at(1)),new OperatingWindows.Session(at(2),null)),at(0),at(3));
        assertEquals(7200,windows.stream().mapToDouble(OperatingWindows.Window::seconds).sum());
        assertEquals(7200,OperatingWindows.intersect(at(0),at(5),windows).stream().mapToDouble(OperatingWindows.Window::seconds).sum());
    }
    @Test void closingServiceContinuesUntilActualCompletion() {
        var windows=OperatingWindows.between(List.of(new OperatingWindows.Session(at(0),null)),at(0),at(5));
        assertEquals(18000,windows.getFirst().seconds());
    }
    @Test void futureCancelledSessionHasNoOperatingHours() {
        assertTrue(OperatingWindows.between(List.of(new OperatingWindows.Session(at(4),at(2))),at(0),at(3)).isEmpty());
    }
    @Test void overlappingBackdatedSessionsAreCountedOnlyOnce() {
        var windows=OperatingWindows.between(List.of(new OperatingWindows.Session(at(0),at(3)),new OperatingWindows.Session(at(2),null)),at(0),at(4));
        assertEquals(1,windows.size());assertEquals(14400,windows.getFirst().seconds());
    }
}
