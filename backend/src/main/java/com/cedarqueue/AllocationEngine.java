package com.cedarqueue;

import java.time.*;
import java.util.*;

/** Pure constrained scheduler. Each choice is recomputed at a single authoritative instant. */
public final class AllocationEngine {
    public record Party(UUID id,int size,boolean accessible,String preference,boolean priority,Instant fairnessSince,long sequence) {}
    public record Table(UUID id,int capacity,boolean accessible,String area) {}
    public record Choice(Party party,Table table,double score,String reason) {}
    public static boolean compatible(Party p,Table t) { return t.capacity()>=p.size() && (!p.accessible() || t.accessible()); }
    public Optional<Choice> select(List<Party> parties,List<Table> tables,int burst,Policy policy,Instant now) {
        var choices=new ArrayList<Choice>();
        for(var party:parties) for(var table:tables) if(compatible(party,table)) {
            long age=Math.max(0,Duration.between(party.fairnessSince(),now).toMinutes());
            double score=Math.floor(age/(double)policy.agingMinutes())+(party.priority()?2:0)
                -(table.capacity()-party.size())*policy.capacityWastePenalty()
                +(party.preference()!=null && party.preference().equalsIgnoreCase(table.area())?2:0);
            choices.add(new Choice(party,table,score,"Age, verified priority, seating preference and capacity efficiency"));
        }
        if(choices.isEmpty()) return Optional.empty();
        Comparator<Party> oldest=Comparator.comparing(Party::fairnessSince).thenComparingLong(Party::sequence).thenComparing(Party::id);
        // The hard ordinary opportunity bound applies even when a priority party is overdue.
        if(burst>=policy.priorityBurstLimit()) {
            var ordinary=choices.stream().map(Choice::party).filter(p->!p.priority()).min(oldest);
            if(ordinary.isPresent()) return bestFor(choices,ordinary.get(),"Ordinary-party opportunity after priority burst limit");
        }
        var overdue=choices.stream().map(Choice::party)
            .filter(p->!p.fairnessSince().plusSeconds(policy.starvationMinutes()*60L).isAfter(now)).min(oldest);
        if(overdue.isPresent()) return bestFor(choices,overdue.get(),"Starvation protection: oldest overdue compatible party");
        return choices.stream().min(Comparator.comparingDouble(Choice::score).reversed()
            .thenComparing(Choice::party,oldest).thenComparingInt(c->c.table().capacity()).thenComparing(c->c.table().id()));
    }
    private Optional<Choice> bestFor(List<Choice> choices,Party party,String reason) {
        return choices.stream().filter(c->c.party().id().equals(party.id()))
            .min(Comparator.comparingDouble(Choice::score).reversed().thenComparing(c->c.table().id()))
            .map(c->new Choice(c.party(),c.table(),c.score(),reason));
    }
}
