package com.cedarqueue;

import org.springframework.stereotype.Service;
import jakarta.validation.Validator;
import java.time.*;
import java.util.*;
import static com.cedarqueue.Dtos.map;

@Service
class AdminService {
    final QueueService q;final Store db;final Validator validator;final IdentityService identity;
    AdminService(QueueService q,Store db,Validator validator,IdentityService identity) {this.q=q;this.db=db;this.validator=validator;this.identity=identity;}
    Object restaurant(QueueService.Context c,Requests.RestaurantInput body) {
        ZoneId.of(body.timezone());var r=c.venue();r.name=body.name();r.location=body.location();r.timezone=body.timezone();r.description=body.description();q.audit(c,null,"RESTAURANT_UPDATED",body.reason(),r.name);return map("message","Restaurant updated");
    }
    Object policy(QueueService.Context c,Map<String,Object> input) {
        var data=new LinkedHashMap<>(input);String why=QueueService.reason((String)data.remove("reason"));Policy policy=q.json().convertValue(data,Policy.class);
        if(!validator.validate(policy).isEmpty() || policy.minimumSamples()>policy.sampleSize() || policy.priorityBurstLimit()>2) throw new Problem(400,"INVALID_POLICY","Policy values are out of range; minimum samples must not exceed sample size and priority burst is at most two.");
        c.venue().policyJson=q.json().writeValueAsString(policy);
        if(c.session()!=null && c.session().status==SessionStatus.OPEN) {c.session().policyJson=c.venue().policyJson;c.session().revision++;}
        q.audit(c,null,"POLICY_UPDATED",why,c.venue().policyJson);return policy;
    }
    Object area(QueueService.Context c,Requests.AreaInput body) {var a=new DiningArea();a.restaurantId=c.venue().id;a.name=body.name().trim();db.persist(a);q.audit(c,null,"AREA_CREATED","Manager configuration",a.name);return map("id",a.id,"name",a.name);}
    Object table(QueueService.Context c,UUID id,Requests.TableInput body) {
        var area=db.get(DiningArea.class,body.areaId());if(!area.restaurantId.equals(c.venue().id)) throw Problem.missing();
        RestaurantTable t;
        if(id==null) {t=new RestaurantTable();t.restaurantId=c.venue().id;} else {
            t=db.get(RestaurantTable.class,id);q.version(t,body.expectedVersion());QueueService.reason(body.reason());
            if(t.status==TableStatus.OCCUPIED || t.status==TableStatus.ASSIGNED) throw Problem.conflict("TABLE_BUSY","Resolve the active party before changing table configuration.");
        }
        t.number=body.number().trim();t.areaId=body.areaId();t.capacity=body.capacity();t.accessible=body.accessible();if(id==null)db.persist(t);q.tableState(c,t,body.enabled()?TableStatus.AVAILABLE:TableStatus.UNAVAILABLE,body.enabled());q.audit(c,null,"TABLE_CONFIGURED",id==null?"New table":body.reason(),t.number);return t;
    }
    Object session(QueueService.Context c,String action,Requests.SessionInput body) {
        switch(action) {
            case "open" -> {
                if(c.session()!=null && c.session().status!=SessionStatus.CLOSED) throw Problem.conflict("SESSION_ACTIVE","Close the current session and finish all dining visits before opening another.");
                Instant from=body.opensAt()==null?c.now():body.opensAt(),to=body.closesAt()==null?from.plusSeconds(12*3600):body.closesAt();
                if(!to.isAfter(from)||!to.isAfter(c.now())||Duration.between(from,to).toHours()>36) throw new Problem(400,"INVALID_HOURS","Session end must follow its start and be within 36 hours.");
                db.flush(); // Persist closure before inserting a new row covered by the one-open-session index.
                var s=new OperatingSession();s.restaurantId=c.venue().id;s.opensAt=from;s.closesAt=to;s.policyJson=c.venue().policyJson;db.persist(s);c.venue().currentSessionId=s.id;c.venue().recoveryRequired=false;
            }
            case "close" -> {if(c.session()!=null) q.close(c,body.reason());}
            case "recover" -> {
                if(!c.venue().recoveryRequired) throw Problem.conflict("NOT_RECOVERING","No recovery acknowledgement is pending.");
                long grace=body.graceSeconds()==null?300:body.graceSeconds();
                if(c.session()!=null) for(var e:db.entries(c.session())) {
                    if(e.status==EntryStatus.ARRIVAL_WINDOW) e.arrivalDeadline=e.arrivalDeadline.isAfter(c.now().plusSeconds(grace))?e.arrivalDeadline:c.now().plusSeconds(grace);
                    if(e.status==EntryStatus.CALLED) e.callDeadline=e.callDeadline.isAfter(c.now().plusSeconds(grace))?e.callDeadline:c.now().plusSeconds(grace);
                }
                c.venue().recoveryRequired=false;
            }
            default -> throw Problem.missing();
        }
        q.audit(c,null,"SESSION_"+action.toUpperCase(Locale.ROOT),body.reason(),"Operating session administration");return map("message","Session "+action+" applied");
    }
    Object staff(QueueService.Context c,Requests.StaffInput body) {
        if(body.role()==Role.CUSTOMER) throw new Problem(400,"INVALID_ROLE","Staff role must be HOST, MANAGER or DISPLAY.");
        var account=identity.create(body.email(),body.password(),body.displayName(),body.role());q.audit(c,null,"STAFF_CREATED","Manager provisioned staff",account.role.name());return Dtos.user(account);
    }
}
