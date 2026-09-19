package com.cedarqueue;

import org.springframework.stereotype.Component;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;
import java.time.Instant;
import java.util.concurrent.CopyOnWriteArrayList;

@Component
class EventStreams {
    private final CopyOnWriteArrayList<SseEmitter> streams=new CopyOnWriteArrayList<>();
    private long lastRevision=Long.MIN_VALUE;
    private Instant lastPublished=Instant.EPOCH;
    synchronized SseEmitter connect() {
        if(streams.size()>=256) throw new Problem(503,"STREAM_CAPACITY","Live updates are at capacity. The app will reconnect and keep polling.");
        var s=new SseEmitter(25*60*1000L);streams.add(s);
        s.onCompletion(()->streams.remove(s));s.onTimeout(()->streams.remove(s));s.onError(e->streams.remove(s));
        send(s,0);return s;
    }
    synchronized void publish(long revision) {
        Instant now=Instant.now();
        if(revision==lastRevision && now.isBefore(lastPublished.plusSeconds(15))) return;
        lastRevision=revision;lastPublished=now;for(var s:streams) send(s,revision);
    }
    private void send(SseEmitter s,long revision) {
        try {s.send(SseEmitter.event().name("refresh").data(Dtos.map("revision",revision,"serverTime",Instant.now())));}
        catch(Exception e) { streams.remove(s);s.complete(); }
    }
}
