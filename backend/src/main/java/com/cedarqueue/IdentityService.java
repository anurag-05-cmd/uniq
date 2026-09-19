package com.cedarqueue;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.security.core.Authentication;
import org.springframework.security.crypto.password.PasswordEncoder;
import java.nio.charset.StandardCharsets;
import java.util.*;

@Service
class IdentityService {
    final AccountRepository accounts;final PasswordEncoder passwords;
    IdentityService(AccountRepository accounts,PasswordEncoder passwords) {this.accounts=accounts;this.passwords=passwords;}
    AccountRepository accounts() {return accounts;}
    Account actor(Authentication auth) {
        if(auth==null) throw new Problem(401,"UNAUTHENTICATED","Please sign in.");
        return accounts.findByEmailIgnoreCase(auth.getName()).orElseThrow(Problem::missing);
    }
    @Transactional Account create(String email,String password,String name,Role role) {
        email=email.trim().toLowerCase(Locale.ROOT);
        if(password.getBytes(StandardCharsets.UTF_8).length>72 || password.length()<12) throw new Problem(400,"PASSWORD_LENGTH","Use at least 12 characters and at most 72 UTF-8 bytes.");
        if(accounts.findByEmailIgnoreCase(email).isPresent()) throw Problem.conflict("ACCOUNT_EXISTS","An account already uses this email.");
        var a=new Account();a.email=email;a.passwordHash=passwords.encode(password);a.displayName=name.trim();a.role=role;return accounts.save(a);
    }
    static boolean staff(Account a) { return a.role==Role.HOST || a.role==Role.MANAGER; }
    static void owner(Account a,WaitlistEntry e) { if(!e.customerId.equals(a.id)) throw Problem.missing(); }
    static void readable(Account a,WaitlistEntry e) { if(!staff(a)) owner(a,e); }
}
