import {expect,it} from "vitest";
import {profileLinks} from "./profileLinks";
it("renders external projects as well as TrioZ",()=>expect(profileLinks(JSON.stringify({website:'https://example.org/a',github:'https://github.com/example'})).map(x=>x.domain)).toEqual(['example.org','github.com']));
it.each(['javascript:alert(1)','data:text/html,test','file:///a','https://user:password@example.org'])('blocks unsafe link %s', website=>expect(profileLinks({website})).toEqual([]));
it.each([null,'{',[],{website:''}])('ignores missing or malformed links',raw=>expect(profileLinks(raw)).toEqual([]));
