package com.cedarqueue;

import org.springframework.context.annotation.*;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.core.userdetails.*;
import org.springframework.security.crypto.password.*;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.core.Authentication;
import org.springframework.http.HttpMethod;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.DeserializationFeature;
import org.springframework.boot.jackson.autoconfigure.JsonMapperBuilderCustomizer;
import java.util.*;

@Configuration
class SecurityConfiguration {
    @Bean PasswordEncoder passwordEncoder() { return new DelegatingPasswordEncoder("bcrypt",Map.of("bcrypt",new BCryptPasswordEncoder(12))); }
    @Bean JsonMapperBuilderCustomizer strictJson() { return b->b.disable(DeserializationFeature.ACCEPT_FLOAT_AS_INT).enable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES); }
    @Bean UserDetailsService userDetails(AccountRepository accounts) {
        return email->{ var a=accounts.findByEmailIgnoreCase(email.trim()).orElseThrow(()->new UsernameNotFoundException("Invalid credentials"));
            return User.withUsername(a.email).password(a.passwordHash).roles(a.role.name()).disabled(!a.enabled).build(); };
    }
    @Bean SecurityFilterChain security(HttpSecurity http,AccountRepository accounts,ObjectMapper json) throws Exception {
        http.authorizeHttpRequests(a->a
            .requestMatchers("/api/v1/auth/csrf","/api/v1/auth/register","/api/v1/auth/login","/actuator/health","/error").permitAll()
            .requestMatchers(HttpMethod.GET,"/api/v1/restaurant").permitAll()
            .requestMatchers("/actuator/**").hasRole("MANAGER")
            .requestMatchers("/api/v1/admin/**","/api/v1/demo/**").hasRole("MANAGER")
            .requestMatchers("/api/v1/host/**").hasAnyRole("HOST","MANAGER")
            .requestMatchers("/api/v1/display/**").hasAnyRole("DISPLAY","HOST","MANAGER")
            .requestMatchers("/api/v1/entries/**","/api/v1/entries","/api/v1/me/entries","/api/v1/me/notifications/**").hasAnyRole("CUSTOMER","HOST","MANAGER")
            .requestMatchers("/api/v1/**").authenticated()
            .anyRequest().permitAll());
        http.formLogin(f->f.loginProcessingUrl("/api/v1/auth/login")
            .successHandler((req,res,auth)->{res.setContentType("application/json");res.getWriter().write(json.writeValueAsString(Dtos.user(accounts.findByEmailIgnoreCase(auth.getName()).orElseThrow())));})
            .failureHandler((req,res,e)->{res.setStatus(401);res.setContentType("application/problem+json");res.getWriter().write("{\"code\":\"BAD_CREDENTIALS\",\"detail\":\"Email or password is incorrect.\"}");}));
        http.logout(l->l.logoutUrl("/api/v1/auth/logout").logoutSuccessHandler((req,res,auth)->res.setStatus(204)));
        http.exceptionHandling(e->e.authenticationEntryPoint((req,res,x)->{res.setStatus(401);res.setContentType("application/problem+json");res.getWriter().write("{\"code\":\"UNAUTHENTICATED\",\"detail\":\"Please sign in.\"}");})
            .accessDeniedHandler((req,res,x)->{res.setStatus(403);res.setContentType("application/problem+json");res.getWriter().write("{\"code\":\"FORBIDDEN\",\"detail\":\"This action is not permitted. Refresh your session if it expired.\"}");}));
        http.headers(h->h.contentSecurityPolicy(c->c.policyDirectives("default-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'")));
        http.addFilterBefore(new RequestGuardFilter(), org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter.class);
        return http.build();
    }
}
