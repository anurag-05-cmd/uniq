package com.cedarqueue;

import org.junit.jupiter.api.Test;
import java.time.*;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

/** Independent acceptance fixtures: fixed instants, no repositories, no mocks of PostgreSQL semantics. */
class AcceptanceEngineTest {
    static final Instant NOW = Instant.parse("2026-09-19T12:00:00Z");
    static final Policy POLICY = Policy.defaults();
    final AllocationEngine allocation = new AllocationEngine();
    final EtaEngine eta = new EtaEngine();
    static UUID id(long value) { return new UUID(0,value); }
    static AllocationEngine.Party party(long id,int size,boolean priority,long ageSeconds) {
        return new AllocationEngine.Party(id(id),size,false,"ANY",priority,NOW.minusSeconds(ageSeconds),id);
    }
    static AllocationEngine.Table table(long id,int capacity) {
        return new AllocationEngine.Table(id(id),capacity,false,"Dining room");
    }
    static List<EtaEngine.Sample> samples() {
        return List.of(120L,180L,150L,210L,240L).stream().map(n->new EtaEngine.Sample(2,n,NOW.minusSeconds(10))).toList();
    }

    @Test void capacityAndAccessibilityAreHardConstraints() {
        assertFalse(AllocationEngine.compatible(party(1,6,false,60),table(2,4)));
        assertTrue(AllocationEngine.compatible(party(1,6,false,60),table(2,8)));
        var accessible = new AllocationEngine.Party(id(1),2,true,"ANY",false,NOW,1);
        assertFalse(AllocationEngine.compatible(accessible,table(2,4)));
        assertTrue(AllocationEngine.compatible(accessible,new AllocationEngine.Table(id(2),4,true,"Terrace")));
    }

    @Test void smallestSuitableTableWinsForAnOtherwiseEqualChoice() {
        var p = party(1,2,false,60);
        var choice = allocation.select(List.of(p),List.of(table(4,8),table(3,6),table(2,2)),0,POLICY,NOW).orElseThrow();
        assertEquals(2,choice.table().capacity());
    }

    @Test void preferenceCannotOverrideInsufficientCapacity() {
        var p = new AllocationEngine.Party(id(1),6,false,"Terrace",true,NOW.minusSeconds(7200),1);
        assertTrue(allocation.select(List.of(p),List.of(new AllocationEngine.Table(id(2),4,true,"Terrace")),0,POLICY,NOW).isEmpty());
    }

    @Test void priorityFloodStillProvidesOrdinaryOpportunityEveryThirdDispatch() {
        int burst = 0, consecutivePriority = 0, ordinaryDispatches = 0;
        var ordinary = party(1,2,false,0);
        for(int i=0;i<10000;i++) {
            var priority = party(100+i,2,true,0);
            var choice = allocation.select(List.of(priority,ordinary),List.of(table(2,2)),burst,POLICY,NOW).orElseThrow();
            if(choice.party().priority()) {
                burst = Math.min(2,burst+1);
                assertTrue(++consecutivePriority<=2,"A continuously eligible ordinary party must receive a dispatch opportunity.");
            } else { ordinaryDispatches++; consecutivePriority=0; burst=0; }
        }
        assertEquals(3333,ordinaryDispatches);
    }

    @Test void burstRuleDoesNotBlockACompatiblePartyForAnIncompatibleOrdinaryParty() {
        var chosen = allocation.select(List.of(party(1,8,false,60),party(2,2,true,0)),List.of(table(3,2)),2,POLICY,NOW).orElseThrow();
        assertEquals(id(2),chosen.party().id());
    }

    @Test void oldestLargePartyGetsStarvationProtection() {
        var large=party(1,6,false,31*60);
        var small=party(2,2,true,60);
        var choice=allocation.select(List.of(small,large),List.of(table(3,8)),0,POLICY,NOW).orElseThrow();
        assertEquals(large.id(),choice.party().id());
        assertTrue(choice.reason().contains("Starvation"));
    }

    @Test void overdueOrdinaryPartyCannotBeBypassedByOverduePriorityAfterBurst() {
        var ordinary=party(1,2,false,31*60);
        var priority=party(2,2,true,60*60);
        assertEquals(ordinary.id(),allocation.select(List.of(priority,ordinary),List.of(table(3,2)),2,POLICY,NOW).orElseThrow().party().id());
    }

    @Test void stableSequenceBreaksEqualScoresIndependentlyOfInputOrder() {
        var a=party(1,2,false,60);var b=party(2,2,false,60);
        assertEquals(a.id(),allocation.select(List.of(b,a),List.of(table(3,2)),0,POLICY,NOW).orElseThrow().party().id());
    }

    @Test void rollingMeanAndResidualMatchBlueprintExample() {
        var estimate=eta.duration(samples(),2,POLICY,NOW);
        assertEquals(180,estimate.meanSeconds());
        assertEquals(5,estimate.count());
        assertEquals(90,eta.residual(estimate,90));
        assertEquals(30,eta.residual(estimate,300));
    }

    @Test void rollingWindowKeepsNewestTwentyAndRejectsFutureOrOldSamples() {
        var rows=new ArrayList<EtaEngine.Sample>();
        for(int i=0;i<21;i++) rows.add(new EtaEngine.Sample(2,100+i*10,NOW.minusSeconds(i)));
        rows.add(new EtaEngine.Sample(2,99999,NOW.plusSeconds(1)));
        rows.add(new EtaEngine.Sample(2,99999,NOW.minusSeconds(7201)));
        var estimate=eta.duration(rows,2,POLICY,NOW);
        assertEquals(20,estimate.count());
        assertEquals(195,estimate.meanSeconds());
    }

    @Test void partySizePoolAndFallbackAreExplicit() {
        assertEquals("PARTY_SIZE_WINDOW",eta.duration(samples(),2,POLICY,NOW).source());
        assertEquals("RESTAURANT_POOL",eta.duration(samples(),8,POLICY,NOW).source());
        var fallback=eta.duration(List.of(),2,POLICY,NOW);
        assertEquals("DEFAULT",fallback.source());
        assertEquals(2700,fallback.meanSeconds());
        assertEquals(0,fallback.count());
    }

    @Test void oneBusyTableProducesExactWaitsAndDoesNotMutateInputs() {
        var pending=List.of(new EtaEngine.Pending(party(1,2,false,60),false,null,Set.of()),new EtaEngine.Pending(party(2,2,false,60),false,null,Set.of()),new EtaEngine.Pending(party(3,2,false,60),false,null,Set.of()));
        var forecast=eta.forecast(pending,List.of(new EtaEngine.Slot(table(9,2),90)),samples(),0,POLICY,NOW);
        assertEquals(90,forecast.get(id(1)).seconds());
        assertEquals(270,forecast.get(id(2)).seconds());
        assertEquals(450,forecast.get(id(3)).seconds());
        assertEquals(NOW.minusSeconds(60),pending.getFirst().party().fairnessSince());
    }

    @Test void noCompatibleCapacityIsUnknownNotAZeroWait() {
        var pending=List.of(new EtaEngine.Pending(party(1,8,false,60),true,null,Set.of()));
        assertTrue(eta.forecast(pending,List.of(new EtaEngine.Slot(table(9,2),0)),samples(),0,POLICY,NOW).isEmpty());
    }

    @Test void snoozeBarrierCannotHoldPartyPastPersistedReleaseDeadline() {
        var pending=List.of(new EtaEngine.Pending(party(1,2,false,3600),false,NOW.plusSeconds(60),Set.of(id(1000))));
        var result=eta.forecast(pending,List.of(new EtaEngine.Slot(table(9,2),0)),samples(),0,POLICY,NOW);
        assertEquals(60,result.get(id(1)).seconds());
    }

    @Test void remoteForecastDisclosesArrivalAssumption() {
        var pending=List.of(new EtaEngine.Pending(party(1,2,false,60),true,null,Set.of()));
        assertTrue(eta.forecast(pending,List.of(new EtaEngine.Slot(table(9,2),0)),samples(),0,POLICY,NOW).get(id(1)).assumesArrival());
    }

    @Test void terminalStatesNeverResurrect() {
        for(var from:List.of(EntryStatus.COMPLETED,EntryStatus.CANCELLED,EntryStatus.EXPIRED,EntryStatus.NO_SHOW))
            for(var to:EntryStatus.values()) assertThrows(Problem.class,()->Lifecycle.require(from,to),from+" -> "+to);
    }

    @Test void remotePartyCannotBeCalledAndCompletionRequiresSeating() {
        assertThrows(Problem.class,()->Lifecycle.require(EntryStatus.WAITING,EntryStatus.CALLED));
        assertThrows(Problem.class,()->Lifecycle.require(EntryStatus.ARRIVAL_WINDOW,EntryStatus.CALLED));
        assertThrows(Problem.class,()->Lifecycle.require(EntryStatus.CALLED,EntryStatus.COMPLETED));
        assertDoesNotThrow(()->Lifecycle.require(EntryStatus.CHECKED_IN,EntryStatus.CALLED));
        assertDoesNotThrow(()->Lifecycle.require(EntryStatus.DINING,EntryStatus.COMPLETED));
    }
}
