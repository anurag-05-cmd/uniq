package com.cedarqueue;

import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.dao.CannotAcquireLockException;
import org.springframework.http.converter.HttpMessageNotReadableException;

class Problem extends RuntimeException {
    final int status; final String code;
    Problem(int status,String code,String message) { super(message);this.status=status;this.code=code; }
    static Problem conflict(String code,String message) { return new Problem(409,code,message); }
    static Problem missing() { return new Problem(404,"NOT_FOUND","This record is unavailable."); }
}
@RestControllerAdvice
class ErrorHandler {
    @ExceptionHandler(Problem.class) ResponseEntity<ProblemDetail> domain(Problem e) { return response(e.status,e.code,e.getMessage()); }
    @ExceptionHandler({MethodArgumentNotValidException.class,HttpMessageNotReadableException.class,IllegalArgumentException.class,tools.jackson.core.JacksonException.class})
    ResponseEntity<ProblemDetail> invalid(Exception e) { return response(400,"VALIDATION","Check the supplied values and try again."); }
    @ExceptionHandler(DataIntegrityViolationException.class) ResponseEntity<ProblemDetail> constraint(Exception e) { return response(409,"CONSTRAINT_CONFLICT","This operation conflicts with a current reservation or existing record. Refresh and try again."); }
    @ExceptionHandler({CannotAcquireLockException.class,jakarta.persistence.OptimisticLockException.class,org.springframework.orm.ObjectOptimisticLockingFailureException.class})
    ResponseEntity<ProblemDetail> concurrent(Exception e) { return response(409,"VERSION_CONFLICT","The record changed. Refresh before trying again."); }
    static ResponseEntity<ProblemDetail> response(int status,String code,String detail) {
        var p=ProblemDetail.forStatusAndDetail(HttpStatusCode.valueOf(status),detail);p.setProperty("code",code);p.setProperty("traceId",org.slf4j.MDC.get("traceId"));
        return ResponseEntity.status(status).body(p);
    }
}
