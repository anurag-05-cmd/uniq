package com.cedarqueue;

import org.springframework.web.bind.annotation.*;
import org.springframework.security.core.Authentication;
import org.springframework.security.web.csrf.CsrfToken;
import org.springframework.http.ResponseEntity;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;
import jakarta.validation.Valid;
import java.util.*;
import static com.cedarqueue.Dtos.map;

@RestController
@RequestMapping("/api/v1")
class ApiController {
    final IdentityService identity;final QueueService queue;final QueryService reads;final AdminService admin;final EventStreams events;final DemoService demo;
    ApiController(IdentityService identity,QueueService queue,QueryService reads,AdminService admin,EventStreams events,DemoService demo) {this.identity=identity;this.queue=queue;this.reads=reads;this.admin=admin;this.events=events;this.demo=demo;}
    @GetMapping("/auth/csrf") Object csrf(CsrfToken token) {return map("token",token.getToken(),"headerName",token.getHeaderName());}
    @PostMapping("/auth/register") ResponseEntity<Object> register(@Valid @RequestBody Requests.Register body) {return ResponseEntity.status(201).body(Dtos.user(identity.create(body.email(),body.password(),body.displayName(),Role.CUSTOMER)));}
    @GetMapping("/me") Object me(Authentication auth) {return Dtos.user(identity.actor(auth));}
    @GetMapping("/restaurant") Object restaurant() {return reads.restaurant();}
    @GetMapping("/me/entries") Object entries(Authentication auth) {return reads.entries(identity.actor(auth));}
    @GetMapping("/entries/{id}") Object entry(Authentication auth,@PathVariable UUID id) {return reads.entry(identity.actor(auth),id);}
    @PostMapping("/entries") ResponseEntity<Object> join(Authentication auth,@RequestHeader(value="Idempotency-Key",required=false) String key,@Valid @RequestBody Requests.Join body) {return ResponseEntity.status(201).body(queue.command(identity.actor(auth),"/entries",key,body,c->queue.join(c,body)));}
    @PostMapping("/entries/{id}/{action:check-in|snooze|cancel}") Object customer(Authentication auth,@PathVariable UUID id,@PathVariable String action,@RequestHeader(value="Idempotency-Key",required=false) String key,@Valid @RequestBody Requests.Change body) {return queue.command(identity.actor(auth),"/entries/"+id+"/"+action,key,body,c->queue.customerAction(c,id,action,body));}
    @PostMapping("/entries/{id}/feedback") Object feedback(Authentication auth,@PathVariable UUID id,@RequestHeader(value="Idempotency-Key",required=false) String key,@Valid @RequestBody Requests.FeedbackInput body) {
        return queue.command(identity.actor(auth),"/entries/"+id+"/feedback",key,body,c->{
            var e=queue.owned(c,id);if(e.status!=EntryStatus.COMPLETED) throw Problem.conflict("STATE_CONFLICT","Feedback is available after dining is completed.");
            if(!queue.store().query(Feedback.class,"where entryId=?1",id).isEmpty()) throw Problem.conflict("FEEDBACK_EXISTS","Feedback has already been submitted.");
            var f=new Feedback();f.entryId=id;f.customerId=c.actor().id;f.rating=body.rating();f.comment=body.comment();f.createdAt=c.now();queue.store().persist(f);return map("id",f.id,"rating",f.rating,"comment",f.comment);
        });
    }
    @GetMapping("/me/notifications") Object notifications(Authentication auth) {return reads.notifications(identity.actor(auth));}
    @PostMapping("/me/notifications/{id}/read") ResponseEntity<Void> readNotification(Authentication auth,@PathVariable UUID id,@RequestHeader(value="Idempotency-Key",required=false) String key) {
        queue.command(identity.actor(auth),"/me/notifications/"+id+"/read",key,Map.of(),c->{var n=queue.store().get(Notification.class,id);if(!n.recipientId.equals(c.actor().id)) throw Problem.missing();if(n.readAt==null)n.readAt=c.now();return null;});return ResponseEntity.noContent().build();
    }
    @GetMapping("/host/board") Object board() {return reads.board();}
    @PostMapping("/host/call-next") ResponseEntity<Object> call(Authentication auth,@RequestHeader(value="Idempotency-Key",required=false) String key,@Valid @RequestBody Requests.Change body) {
        var result=queue.command(identity.actor(auth),"/host/call-next",key,body,c->queue.callNext(c,body));return result==null?ResponseEntity.noContent().build():ResponseEntity.ok(result);
    }
    @PostMapping("/host/entries/{id}/{action}") Object host(Authentication auth,@PathVariable UUID id,@PathVariable String action,@RequestHeader(value="Idempotency-Key",required=false) String key,@Valid @RequestBody Requests.Change body) {return queue.command(identity.actor(auth),"/host/entries/"+id+"/"+action,key,body,c->queue.hostAction(c,id,action,body));}
    @PostMapping("/host/tables/{id}/availability") Object availability(Authentication auth,@PathVariable UUID id,@RequestHeader(value="Idempotency-Key",required=false) String key,@Valid @RequestBody Requests.Availability body) {return queue.command(identity.actor(auth),"/host/tables/"+id+"/availability",key,body,c->queue.availability(c,id,body));}
    @GetMapping("/admin/analytics") Object analytics() {return reads.analytics();}
    @GetMapping("/admin/audit") Object audit() {return reads.audit();}
    @PutMapping("/admin/restaurant") Object updateRestaurant(Authentication auth,@RequestHeader(value="Idempotency-Key",required=false) String key,@Valid @RequestBody Requests.RestaurantInput body) {return queue.command(identity.actor(auth),"/admin/restaurant",key,body,c->admin.restaurant(c,body));}
    @PutMapping("/admin/policy") Object updatePolicy(Authentication auth,@RequestHeader(value="Idempotency-Key",required=false) String key,@RequestBody Map<String,Object> body) {return queue.command(identity.actor(auth),"/admin/policy",key,body,c->admin.policy(c,body));}
    @PostMapping("/admin/areas") Object addArea(Authentication auth,@RequestHeader(value="Idempotency-Key",required=false) String key,@Valid @RequestBody Requests.AreaInput body) {return queue.command(identity.actor(auth),"/admin/areas",key,body,c->admin.area(c,body));}
    @PostMapping("/admin/tables") Object addTable(Authentication auth,@RequestHeader(value="Idempotency-Key",required=false) String key,@Valid @RequestBody Requests.TableInput body) {return queue.command(identity.actor(auth),"/admin/tables",key,body,c->admin.table(c,null,body));}
    @PutMapping("/admin/tables/{id}") Object updateTable(Authentication auth,@PathVariable UUID id,@RequestHeader(value="Idempotency-Key",required=false) String key,@Valid @RequestBody Requests.TableInput body) {return queue.command(identity.actor(auth),"/admin/tables/"+id,key,body,c->admin.table(c,id,body));}
    @PostMapping("/admin/session/{action}") Object session(Authentication auth,@PathVariable String action,@RequestHeader(value="Idempotency-Key",required=false) String key,@Valid @RequestBody Requests.SessionInput body) {return queue.command(identity.actor(auth),"/admin/session/"+action,key,body,c->admin.session(c,action,body));}
    @GetMapping("/admin/staff") Object staff() {return reads.staff();}
    @PostMapping("/admin/staff") Object staff(Authentication auth,@RequestHeader(value="Idempotency-Key",required=false) String key,@Valid @RequestBody Requests.StaffInput body) {return queue.command(identity.actor(auth),"/admin/staff",key,body,c->admin.staff(c,body));}
    @GetMapping("/display/board") Object display() {return queue.display();}
    @GetMapping(value="/events",produces="text/event-stream") SseEmitter events() {return events.connect();}
    @PostMapping("/demo/{action}") Object demo(Authentication auth,@PathVariable String action,@RequestHeader(value="Idempotency-Key",required=false) String key,@Valid @RequestBody Requests.Simulation body) {
        if(!queue.isDemo()) throw Problem.missing();return queue.command(identity.actor(auth),"/demo/"+action,key,body,c->demo.run(c,action,body));
    }
}
