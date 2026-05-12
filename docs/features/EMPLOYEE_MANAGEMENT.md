# Employee Management

The Employees page is the main directory for team member records. It helps HR teams and managers create, search, edit, and understand employee availability.

## Employee Directory

Employees are displayed as cards with key information such as:

- Name
- Role
- Team
- Rating
- Availability
- Skills
- Profile photo or initials

## Employee Search and Filters

Users can filter employees by:

- Skill
- Team
- Availability
- Minimum rating

This makes it easier to find people for projects or identify available team members.

## Add Employee

The Add Employee modal captures:

- Full name
- Email
- Role
- Team
- Rating
- Total experience
- Work start and end time
- Skill set
- Profile photo URL
- Availability for projects

## Skills

Employee profiles support multiple skills. Each skill can include:

- Skill name
- Skill level
- Years of experience with that skill

This helps project leads match employees to project requirements.

## Profile Photo

The employee form supports a profile photo URL and can fetch a profile photo from a LinkedIn-style profile link when available.

## Availability

Each employee can be marked as available or unavailable for project work. Availability is used by dashboards, filters, the mini assistant, and project staffing decisions.

## Edit Employee

Existing employee records can be edited from the employee cards. Edit mode reuses the employee modal and changes the submit action to save changes.

## Delete Employee

Employees can be deleted from their cards. The app asks for confirmation before removing the record.

## Project Assignments

When editing an employee, users can assign the employee to projects as:

- Manager
- Team Lead
- Member

Users can also unassign employees from projects when needed.

## Draft Close Prompt

If a user starts filling employee details and closes the modal, Osmium asks whether they want to resume editing or close the draft. This prevents accidental loss of employee information.
