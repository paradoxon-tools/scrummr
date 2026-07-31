# Scrummr

Scrummr supports teams that collaboratively review and refine Jira work in live sessions.

## Language

**Organization**:
The subscribing company and administrative boundary that contains one or more Workspaces.
_Avoid_: Tenant, customer account

**Workspace**:
A durable team boundary that owns its Jira connection, Jira scope, membership, and role assignments.
_Avoid_: Team, account

**Member**:
An authenticated person who belongs to a Workspace.
_Avoid_: User

**Room**:
A durable, purpose-specific collaboration entry point within a Workspace, with a stable link and configuration across Sessions.
_Avoid_: Session, meeting

**Session**:
One active collaboration period in a Room, beginning after a Host successfully refreshes its Jira work items and ending after no Host remains connected beyond a short reconnection grace period.
_Avoid_: Room, run

**Working Copy**:
The shared representation of selected Jira work items that Participants edit together during a Session; any unfinalized changes are discarded when that Session ends.
_Avoid_: Draft, local copy

**Team Focus**:
The single Jira work item selected by the Host for collaborative editing and estimation in the current Session.
_Avoid_: Current ticket, selected issue

**Personal View**:
A Jira work item that a Participant temporarily inspects read-only while not following Team Focus.
_Avoid_: Private ticket

**Finalize**:
Finish the Session's work on the Team Focus by publishing its eligible changes to Jira and recording it as processed, without changing its Jira workflow status.
_Avoid_: Complete, close, transition

**Estimation Round**:
A Session-scoped cycle in which Participants submit private estimates, the Host reveals them for discussion, and the team may vote again.
_Avoid_: Poll

**Final Estimate**:
The estimate selected by the Host after an Estimation Round and included when the Team Focus is Finalized.
_Avoid_: Winning vote

**Participant**:
A person currently taking part in a Session, whether as a Member or Guest.
_Avoid_: Attendee, user

**Display Name**:
A Participant-chosen, editable name shown consistently to everyone in a Session; for Guests it is remembered only by their own browser and grants no identity or authority.
_Avoid_: Username, account name

**Host**:
The single Participant who controls an active Session, initially the authorized Member who started it.
_Avoid_: Owner, orchestrator

**Takeover**:
An eligible Participant assuming Host control while the current Host is disconnected, allowing the same Session to continue within its reconnection grace period.
_Avoid_: Session transfer

**Guest**:
A Participant who joins a Session without Workspace membership or an authenticated account and has access only within that Session.
_Avoid_: Anonymous user
