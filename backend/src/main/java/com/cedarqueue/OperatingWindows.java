package com.cedarqueue;

import java.time.*;
import java.util.*;

/** Actual service intervals, merged so a backdated schedule never double-counts time. */
final class OperatingWindows {
    record Session(Instant opensAt,Instant closedAt) {}
    record Window(Instant start,Instant end) {
        double seconds() {return Duration.between(start,end).toMillis()/1000.0;}
    }
    static List<Window> between(List<Session> sessions,Instant from,Instant now) {
        var windows=sessions.stream().map(s->new Window(later(s.opensAt(),from),earlier(s.closedAt()==null?now:s.closedAt(),now)))
            .filter(w->w.end().isAfter(w.start())).sorted(Comparator.comparing(Window::start)).toList();
        var merged=new ArrayList<Window>();
        for(var next:windows) {
            if(!merged.isEmpty()&&!next.start().isAfter(merged.getLast().end())) {
                var previous=merged.removeLast();merged.add(new Window(previous.start(),later(previous.end(),next.end())));
            } else merged.add(next);
        }
        return merged;
    }
    static List<Window> intersect(Instant start,Instant end,List<Window> windows) {
        return windows.stream().map(w->new Window(later(start,w.start()),earlier(end,w.end())))
            .filter(w->w.end().isAfter(w.start())).toList();
    }
    static Instant later(Instant a,Instant b) {return a.isAfter(b)?a:b;}
    static Instant earlier(Instant a,Instant b) {return a.isBefore(b)?a:b;}
}
