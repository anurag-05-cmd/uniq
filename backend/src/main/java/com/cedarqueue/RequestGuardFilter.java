package com.cedarqueue;

import jakarta.servlet.*;
import jakarta.servlet.http.*;
import org.slf4j.MDC;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.filter.OncePerRequestFilter;
import java.io.IOException;
import java.time.Clock;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;

/** Bounded, single-instance abuse controls. Persistent queue correctness never depends on this cache. */
final class RequestGuardFilter extends OncePerRequestFilter {
    private final Clock clock;
    private final ConcurrentHashMap<String,Window> windows = new ConcurrentHashMap<>();
    static final int MAX_BUCKETS = 8192;
    static final class Window {
        final long start;
        int count;
        final Set<String> intents = new HashSet<>();
        Window(long start) { this.start=start; }
    }
    RequestGuardFilter() { this(Clock.systemUTC()); }
    RequestGuardFilter(Clock clock) { this.clock=clock; }

    boolean allow(String key,int limit,long periodMillis,String intent,boolean count) {
        long now=clock.millis();
        if(windows.size()>=MAX_BUCKETS && !windows.containsKey(key)) {
            windows.entrySet().removeIf(e->now-e.getValue().start>=300000);
            if(windows.size()>=MAX_BUCKETS) return false;
        }
        Window window=windows.compute(key,(k,v)->v==null || now-v.start>=periodMillis ? new Window(now) : v);
        synchronized(window) {
            if(intent!=null && window.intents.contains(intent)) return true;
            if(window.count>=limit) return false;
            if(count) {
                window.count++;
                if(intent!=null) window.intents.add(intent);
            }
            return true;
        }
    }
    void failure(String key) {
        Window w=windows.computeIfAbsent(key,k->new Window(clock.millis()));
        synchronized(w) { w.count++; }
    }
    @Override protected void doFilterInternal(HttpServletRequest request,HttpServletResponse response,FilterChain chain) throws ServletException,IOException {
        long started=System.nanoTime();
        String path=request.getRequestURI();
        String requestedId=request.getHeader("X-Request-Id");
        String trace=requestedId!=null && requestedId.matches("[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}") ? requestedId : UUID.randomUUID().toString();
        response.setHeader("X-Request-Id",trace);
        if(path.startsWith("/api/")) response.setHeader("Cache-Control","no-store");
        MDC.put("traceId",trace);
        String loginKey=null;
        try {
            if("POST".equals(request.getMethod())) {
                String ip=request.getRemoteAddr();
                if(path.equals("/api/v1/auth/login")) {
                    String username=Objects.toString(request.getParameter("username"),"").trim().toLowerCase(Locale.ROOT);
                    if(username.length()>254) { denied(response); return; }
                    loginKey="login:"+ip+":"+username;
                    if(!allow(loginKey,5,300000,null,false)) { denied(response);return; }
                } else if(path.equals("/api/v1/auth/register")) {
                    if(!allow("register:"+ip,60,60000,null,true)) { denied(response);return; }
                } else {
                    var authentication=SecurityContextHolder.getContext().getAuthentication();
                    String actor=authentication==null ? ip : authentication.getName();
                    String intent=request.getHeader("Idempotency-Key");
                    if(intent!=null && intent.length()>80) intent=null;
                    if(path.equals("/api/v1/entries") && !allow("join:"+actor,5,60000,intent,true)) { denied(response);return; }
                    if(path.matches("/api/v1/entries/[^/]+/check-in") && !allow("qr:"+actor,10,60000,intent,true)) { denied(response);return; }
                }
            }
            chain.doFilter(request,response);
            if(loginKey!=null) {
                if(response.getStatus()==401) failure(loginKey);
                else if(response.getStatus()<400) windows.remove(loginKey);
            }
        } finally {
            Object mapped=request.getAttribute(org.springframework.web.servlet.HandlerMapping.BEST_MATCHING_PATTERN_ATTRIBUTE);
            String route=mapped instanceof String pattern?pattern:
                Set.of("/api/v1/auth/login","/api/v1/auth/logout","/api/v1/auth/csrf","/api/v1/auth/register").contains(path)?path:"unmapped";
            org.slf4j.LoggerFactory.getLogger(RequestGuardFilter.class).atInfo()
                .addKeyValue("http.method",request.getMethod()).addKeyValue("http.route",route)
                .addKeyValue("http.status_code",response.getStatus())
                .addKeyValue("duration_ms",(System.nanoTime()-started)/1_000_000.0)
                .log("HTTP request completed");
            MDC.remove("traceId");
        }
    }
    private static void denied(HttpServletResponse response) throws IOException {
        response.setStatus(429);
        response.setContentType("application/problem+json");
        response.setHeader("Retry-After","60");
        response.getWriter().write("{\"code\":\"RATE_LIMITED\",\"detail\":\"Too many attempts. Please wait before trying again.\"}");
    }
}
