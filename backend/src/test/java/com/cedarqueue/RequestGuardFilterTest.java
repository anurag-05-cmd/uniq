package com.cedarqueue;
import org.junit.jupiter.api.Test;
import java.time.*;
import static org.junit.jupiter.api.Assertions.*;
class RequestGuardFilterTest {
    @Test void structuredRequestLogContainsCorrelationAndTemplateButNoSecrets() throws Exception {
        var logger=(ch.qos.logback.classic.Logger)org.slf4j.LoggerFactory.getLogger(RequestGuardFilter.class);
        var capture=new ch.qos.logback.core.read.ListAppender<ch.qos.logback.classic.spi.ILoggingEvent>();capture.start();logger.addAppender(capture);
        try {
            var request=new org.springframework.mock.web.MockHttpServletRequest("POST","/api/v1/entries/private-customer-id/check-in");
            request.setQueryString("challenge=PRIVATE_QR_CHALLENGE");request.setContent("{\"password\":\"PRIVATE_PASSWORD\"}".getBytes(java.nio.charset.StandardCharsets.UTF_8));
            request.addHeader("X-Request-Id","PRIVATE_CUSTOMER_SUPPLIED_VALUE");
            request.setAttribute(org.springframework.web.servlet.HandlerMapping.BEST_MATCHING_PATTERN_ATTRIBUTE,"/api/v1/entries/{id}/check-in");
            var response=new org.springframework.mock.web.MockHttpServletResponse();
            new RequestGuardFilter().doFilter(request,response,new org.springframework.mock.web.MockFilterChain());
            var event=capture.list.getLast();String fields=event.getFormattedMessage()+event.getKeyValuePairs()+event.getMDCPropertyMap();
            assertTrue(fields.contains("/api/v1/entries/{id}/check-in"));
            assertFalse(fields.contains("PRIVATE_"));assertFalse(fields.contains("private-customer-id"));
            assertNotNull(event.getMDCPropertyMap().get("traceId"));assertNull(org.slf4j.MDC.get("traceId"));
            assertDoesNotThrow(()->java.util.UUID.fromString(response.getHeader("X-Request-Id")));
        } finally {logger.detachAppender(capture);capture.stop();}
    }
    @Test void identicalIntentRetriesDoNotSpendAdditionalJoinQuota() {
        var guard=new RequestGuardFilter(Clock.fixed(Instant.EPOCH,ZoneOffset.UTC));
        for(int i=0;i<20;i++) assertTrue(guard.allow("join:guest",5,60000,"same-intent",true));
        for(int i=0;i<4;i++) assertTrue(guard.allow("join:guest",5,60000,"intent-"+i,true));
        assertFalse(guard.allow("join:guest",5,60000,"sixth-intent",true));
        assertTrue(guard.allow("join:another",5,60000,"sixth-intent",true));
    }
    @Test void loginGuardCountsFailuresAndKeepsAccountsIndependent() {
        var guard=new RequestGuardFilter(Clock.fixed(Instant.EPOCH,ZoneOffset.UTC));
        for(int i=0;i<5;i++) { assertTrue(guard.allow("login:one",5,300000,null,false));guard.failure("login:one"); }
        assertFalse(guard.allow("login:one",5,300000,null,false));
        assertTrue(guard.allow("login:two",5,300000,null,false));
    }
}
